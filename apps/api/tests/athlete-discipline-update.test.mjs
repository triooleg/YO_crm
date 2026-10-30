import assert from 'node:assert/strict';
import test from 'node:test';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { loadTargetModule } from './overview-target-loader.mjs';

const { UpdateAthleteDto } = loadTargetModule('clients/clients.dto.ts');
const { ClientsService } = loadTargetModule('clients/clients.service.ts');
const actor = { id: 'manager', role: 'MANAGER' };
const names = { firstName: 'Анна', lastName: null, expectedFirstName: 'Анна', expectedLastName: null };
const sport = { ...names, discipline: 'FIGURE_SKATING', expectedDiscipline: 'RHYTHMIC_GYMNASTICS' };
const dtoErrors = input => validate(plainToInstance(UpdateAthleteDto, input), { whitelist: true, forbidNonWhitelisted: true });

test('existing athlete DTO accepts the paired enum sport update and nullable expected sport', async () => {
  assert.deepEqual(await dtoErrors(sport), []);
  assert.deepEqual(await dtoErrors({ ...sport, expectedDiscipline: null }), []);
  assert.deepEqual(await dtoErrors(names), []);
});

function fixture({ failAudit = false, loseClaim = false } = {}) {
  const state = {
    client: { id: 'client', archivedAt: null },
    athlete: { id: 'athlete', clientId: 'client', firstName: 'Анна', lastName: null,
      discipline: 'RHYTHMIC_GYMNASTICS', archivedAt: null },
    order: { discipline: 'RHYTHMIC_GYMNASTICS' }, designs: [{ discipline: 'RHYTHMIC_GYMNASTICS' }],
    snapshots: [{ id: 'immutable', values: { m1: 70, m6: 42.5 }, definitionVersion: 'PARENT_BODY_V1' }],
    activities: [], audits: [],
  };
  const matches = (row, where) => row && Object.entries(where).every(([key, value]) => row[key] === value);
  const prisma = { $transaction: async callback => {
    const draft = structuredClone(state);
    const tx = {
      $executeRaw: async () => 1, $queryRaw: async () => [],
      client: { findFirst: async ({ where }) => matches(draft.client, where) ? { ...draft.client } : null },
      athlete: {
        findFirst: async ({ where }) => matches(draft.athlete, where) ? { ...draft.athlete } : null,
        updateMany: async ({ where, data }) => {
          if (loseClaim || !matches(draft.athlete, where)) return { count: 0 };
          Object.assign(draft.athlete, data); return { count: 1 };
        },
        findUniqueOrThrow: async () => ({ ...draft.athlete }),
      },
      activity: { create: async ({ data }) => { draft.activities.push(structuredClone(data)); return data; } },
      auditLog: { create: async ({ data }) => {
        if (failAudit) throw Error('audit unavailable');
        draft.audits.push(structuredClone(data)); return data;
      } },
    };
    const result = await callback(tx); Object.assign(state, draft); return result;
  } };
  return { state, service: new ClientsService(prisma) };
}

test('sport-only update changes the owned athlete, audits only sport and leaves designs/orders/snapshots immutable', async () => {
  const f = fixture(), before = structuredClone(f.state);
  const result = await f.service.updateAthlete('client', 'athlete', sport, actor);
  assert.equal(result.discipline, 'FIGURE_SKATING');
  assert.equal(result.firstName, 'Анна');
  assert.deepEqual(f.state.order, before.order);
  assert.deepEqual(f.state.designs, before.designs);
  assert.deepEqual(f.state.snapshots, before.snapshots);
  assert.deepEqual(f.state.audits, [{ actorId: actor.id, action: 'UPDATE', entityType: 'Athlete', entityId: 'athlete',
    before: { discipline: 'RHYTHMIC_GYMNASTICS' }, after: { discipline: 'FIGURE_SKATING' } }]);
  assert.equal(f.state.activities[0].type, 'ATHLETE_DISCIPLINE_UPDATED');
});

test('DTO rejects unpaired, null target and unknown enum values while retaining all existing name tokens', async () => {
  const invalid = [
    { ...names, discipline: 'FIGURE_SKATING' }, { ...names, expectedDiscipline: null },
    { ...sport, discipline: null }, { ...sport, discipline: 'UNKNOWN' },
    { ...sport, expectedDiscipline: 'UNKNOWN' }, { ...sport, expectedDiscipline: undefined },
    { ...sport, discipline: ['FIGURE_SKATING'] }, { ...sport, expectedDiscipline: 1 },
  ];
  for (const key of ['firstName', 'lastName', 'expectedFirstName', 'expectedLastName']) {
    const input = { ...sport }; delete input[key]; invalid.push(input);
  }
  for (const input of invalid) assert.ok((await dtoErrors(input)).length > 0, JSON.stringify(input));
  for (const discipline of ['RHYTHMIC_GYMNASTICS', 'ACROBATIC_GYMNASTICS', 'FIGURE_SKATING',
    'AEROBIC_GYMNASTICS', 'BATON_TWIRLING_MAJORETTE', 'OTHER']) {
    assert.deepEqual(await dtoErrors({ ...sport, discipline }), []);
  }
});

test('service rejects malformed sport pairs even when called without the HTTP validation pipe', async () => {
  for (const extra of [{ discipline: 'UNKNOWN', expectedDiscipline: null }, { discipline: 'FIGURE_SKATING' },
    { expectedDiscipline: null }, { discipline: null, expectedDiscipline: null }]) {
    const f = fixture(), before = structuredClone(f.state);
    await assert.rejects(f.service.updateAthlete('client', 'athlete', { ...names, ...extra }, actor), e => e.getStatus() === 400);
    assert.deepEqual(f.state, before);
  }
});

test('foreign or archived athlete/client stays unavailable before update and before replay', async () => {
  for (const alter of [
    f => { f.state.athlete.clientId = 'foreign'; },
    f => { f.state.athlete.archivedAt = new Date(); },
    f => { f.state.client.archivedAt = new Date(); },
    f => { f.state.athlete.id = 'other-athlete'; },
  ]) {
    const f = fixture(); alter(f); const before = structuredClone(f.state);
    await assert.rejects(f.service.updateAthlete('client', 'athlete', sport, actor), e => e.getStatus() === 404);
    assert.deepEqual(f.state, before);
  }
});

test('both name CAS and sport CAS reject stale non-replay requests without side effects', async () => {
  for (const input of [
    { ...sport, expectedDiscipline: 'OTHER' }, { ...sport, expectedDiscipline: null },
    { ...sport, expectedFirstName: 'Stale' }, { ...sport, expectedLastName: 'Stale' },
  ]) {
    const f = fixture(), before = structuredClone(f.state);
    await assert.rejects(f.service.updateAthlete('client', 'athlete', input, actor), e => e.getStatus() === 409);
    assert.deepEqual(f.state, before);
  }
  const f = fixture({ loseClaim: true }), before = structuredClone(f.state);
  await assert.rejects(f.service.updateAthlete('client', 'athlete', sport, actor), e => e.getStatus() === 409);
  assert.deepEqual(f.state, before);
});

test('nullable expected sport compares against actual NULL instead of bypassing the claim', async () => {
  const f = fixture(); f.state.athlete.discipline = null;
  const result = await f.service.updateAthlete('client', 'athlete', { ...sport, expectedDiscipline: null }, actor);
  assert.equal(result.discipline, 'FIGURE_SKATING');
  assert.deepEqual(f.state.audits[0].before, { discipline: null });
});

test('unknown-response replay returns the current requested name and sport without duplicate audit/activity', async () => {
  const f = fixture();
  const input = { ...sport, firstName: ' Олена ', lastName: ' Коваль ' };
  const first = await f.service.updateAthlete('client', 'athlete', input, actor);
  const saved = structuredClone(f.state);
  const replay = await f.service.updateAthlete('client', 'athlete', input, actor);
  assert.deepEqual(replay, first);
  assert.deepEqual(f.state, saved);
  await assert.rejects(f.service.updateAthlete('client', 'athlete', { ...input, discipline: 'OTHER' }, actor), e => e.getStatus() === 409);
  assert.deepEqual(f.state, saved);
});

test('extended exact-current request is a no-op but a different requested name cannot replay stale CAS', async () => {
  const f = fixture(), before = structuredClone(f.state);
  const result = await f.service.updateAthlete('client', 'athlete', {
    ...sport, discipline: 'RHYTHMIC_GYMNASTICS', expectedDiscipline: 'OTHER', expectedFirstName: 'Stale',
  }, actor);
  assert.deepEqual(result, before.athlete);
  assert.deepEqual(f.state, before);
  await assert.rejects(f.service.updateAthlete('client', 'athlete', {
    ...sport, firstName: 'Different', discipline: 'RHYTHMIC_GYMNASTICS', expectedDiscipline: 'OTHER',
  }, actor), e => e.getStatus() === 409);
});

test('combined name and sport update audits only truly changed fields with existing name event semantics', async () => {
  const f = fixture();
  await f.service.updateAthlete('client', 'athlete', { ...sport, firstName: 'Олена' }, actor);
  assert.deepEqual(f.state.audits[0].before, { firstName: 'Анна', discipline: 'RHYTHMIC_GYMNASTICS' });
  assert.deepEqual(f.state.audits[0].after, { firstName: 'Олена', discipline: 'FIGURE_SKATING' });
  assert.equal(f.state.activities[0].type, 'ATHLETE_UPDATED');
  assert.equal(f.state.activities[0].actorId, actor.id);
});

test('legacy name-only consumers keep sport and stale name-CAS behavior without the new replay exception', async () => {
  const f = fixture();
  await f.service.updateAthlete('client', 'athlete', { ...names, firstName: 'Олена' }, actor);
  assert.equal(f.state.athlete.discipline, 'RHYTHMIC_GYMNASTICS');
  assert.deepEqual(f.state.audits[0].before, { firstName: 'Анна', lastName: null });
  assert.deepEqual(f.state.audits[0].after, { firstName: 'Олена', lastName: null });
  const saved = structuredClone(f.state);
  await assert.rejects(f.service.updateAthlete('client', 'athlete', { ...names, firstName: 'Олена' }, actor), e => e.getStatus() === 409);
  assert.deepEqual(f.state, saved);
});

test('audit failure rolls back the athlete change and activity atomically', async () => {
  const f = fixture({ failAudit: true }), before = structuredClone(f.state);
  await assert.rejects(f.service.updateAthlete('client', 'athlete', sport, actor), /audit unavailable/);
  assert.deepEqual(f.state, before);
});
