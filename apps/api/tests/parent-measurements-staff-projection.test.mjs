import assert from 'node:assert/strict';
import test from 'node:test';
import { loadTargetModule } from './overview-target-loader.mjs';

const { ParentMeasurementsService } = loadTargetModule('parent-measurements/parent-measurements.service.ts');
const submittedAt = new Date('2026-10-19T08:15:00.000Z');
const measuredAt = new Date('2026-10-17T00:00:00.000Z');

function fixture() {
  const invitation = { id: 'invite', mode: 'SHARED', locale: 'en', tokenHash: 'SECRET_INVITE' };
  const participant = { invitation, locale: 'it', units: 'cm', credentials: ['SECRET_COOKIE'] };
  const child = { draft: { firstName: 'Current draft', locale: 'de', units: 'cm', age: 15 }, participant };
  const submission = {
    id: 'submission', athleteId: 'athlete', measurementId: 'measurement', submittedAt,
    updatedAt: new Date('2026-10-19T09:00:00.000Z'), reviewStatus: 'RECEIVED', child,
    operationKey: 'SECRET_OPERATION', requestHash: 'SECRET_REQUEST',
    payload: { firstName: 'Submitted child', locale: 'fr', units: 'in', age: 9,
      notes: 'Submitted notes', values: { m1: 70, m2: 56, m3: 72, m15: 122 } },
    measurement: { measuredAt, definitionVersion: 'PARENT_BODY_V1',
      values: { m1: 70, m2: 56, m3: 72, m15: 122 }, notes: 'Submitted notes' },
  };
  const state = { submissions: [submission], invitations: [{ id: invitation.id, mode: invitation.mode, locale: invitation.locale }],
    linked: 0, expectedPieces: 3, orderAvailable: true, activities: [],
    athletes: [{ id: 'athlete', firstName: 'Submitted child', lastName: null, clientId: 'client', archivedAt: null }] };
  // Respect Prisma select/include so a missing relation fetch cannot pass accidentally.
  function project(row, query) {
    if (query === true) return structuredClone(row);
    const result = query.select ? {} : structuredClone(row);
    for (const [key, value] of Object.entries(query.select ?? query.include ?? {})) {
      if (value) result[key] = row[key] == null ? row[key] : project(row[key], value);
    }
    return result;
  }
  const tx = {
    $executeRaw: async () => 1, $executeRawUnsafe: async () => 1, $queryRaw: async () => [],
    order: {
      findFirst: async () => state.orderAvailable ? { id: 'order', number: 'YO-TEST', clientId: 'client' } : null,
      findUniqueOrThrow: async () => ({ clientId: 'client' }),
    },
    measurementInvitation: { findMany: async () => state.invitations },
    measurementSubmission: { findMany: async query => {
      assert.deepEqual(query.where, { child: { participant: { invitation: { orderId: 'order' } } } });
      assert.equal(query.take, 100);
      assert.deepEqual(query.orderBy, { submittedAt: 'desc' });
      return state.submissions.map(row => project(row, query));
    } },
    orderItemInstance: { count: async ({ where }) => where.measurementId ? state.linked : state.expectedPieces },
    measurementParticipantChild: { findMany: async () => [{ id: 'child', revision: 2, draft: child.draft, athleteId: 'athlete' }] },
    athlete: { findMany: async query => {
      assert.deepEqual(query.where, { clientId: 'client', archivedAt: null });
      return state.athletes.filter(row => row.clientId === query.where.clientId && row.archivedAt === null)
        .map(row => project(row, query));
    } },
    activity: { findMany: async query => {
      assert.deepEqual(query.where, { orderId: 'order', type: { in: ['ATHLETE_CREATED', 'MEASUREMENT_CREATED'] } });
      assert.deepEqual(query.select, { metadata: true });
      return state.activities.filter(row => row.orderId === query.where.orderId && query.where.type.in.includes(row.type))
        .map(row => project(row, query));
    } },
  };
  return { state, submission, child, invitation,
    service: new ParentMeasurementsService({ $transaction: callback => callback(tx) }, {}) };
}

test('staff sees received provenance from the immutable submission, not current draft or participant preferences', async () => {
  const f = fixture();
  const result = await f.service.dashboard('order');
  assert.deepEqual(result.submissions[0].provenance, {
    submittedAt, invitationMode: 'SHARED', locale: 'fr', units: 'in', ageYears: 9, source: 'PARENT',
  });
  f.child.draft = { firstName: 'Edited later', locale: 'ru', units: 'cm', age: 18 };
  f.child.participant.locale = 'es';
  assert.deepEqual((await f.service.dashboard('order')).submissions[0].provenance, result.submissions[0].provenance);
  assert.equal(result.submissions[0].childName, 'Submitted child');
});

test('historical submissions without capture metadata remain unknown despite a populated current draft', async () => {
  const f = fixture();
  delete f.submission.payload.locale;
  delete f.submission.payload.units;
  delete f.submission.payload.age;
  f.invitation.mode = 'PERSONAL';
  // The corresponding invitation need not be among the dashboard's newest100 invitations.
  f.state.invitations = [];
  const { submissions } = await f.service.dashboard('order');
  assert.deepEqual(submissions[0].provenance, {
    submittedAt, invitationMode: 'PERSONAL', locale: null, units: null, ageYears: null, source: 'PARENT',
  });
});

test('only validated capture metadata is exposed; zero age and both supported units retain their meaning', async () => {
  for (const locale of ['ru', 'en', 'fr', 'de', 'es', 'it']) {
    const f = fixture();
    Object.assign(f.submission.payload, { locale, units: 'cm', age: 0 });
    assert.deepEqual((await f.service.dashboard('order')).submissions[0].provenance, {
      submittedAt, invitationMode: 'SHARED', locale, units: 'cm', ageYears: 0, source: 'PARENT',
    });
  }
  for (const age of [null, '9', -1, 121, 9.5]) {
    const f = fixture();
    Object.assign(f.submission.payload, { locale: 'SECRET_CONTACT', units: { token: 'SECRET_TOKEN' }, age });
    f.invitation.mode = 'SECRET_MODE';
    assert.deepEqual((await f.service.dashboard('order')).submissions[0].provenance, {
      submittedAt, invitationMode: null, locale: null, units: null, ageYears: null, source: 'PARENT',
    });
  }
});

test('provenance is additive: received/reviewed/assigned remain independent and existing warnings and cardinality survive', async () => {
  const f = fixture();
  f.submission.payload.evaluatedWarnings = [{ code: 'OUTSIDE_APPROVED_RANGE', field: 1,
    valueCm: 70, lowerCm: 72, upperCm: 85, acknowledged: true }];
  f.state.submissions.push({ ...structuredClone(f.submission), id: 'older-submission', reviewStatus: 'VERIFIED',
    submittedAt: new Date('2026-10-18T08:00:00.000Z') });
  const result = await f.service.dashboard('order');
  assert.equal(result.submissions.length, 2);
  assert.equal(result.expectedPieces, 3);
  assert.deepEqual(result.submissions.map(row => [row.id, row.reviewStatus, row.assignmentStatus]), [
    ['submission', 'RECEIVED', 'UNASSIGNED'], ['older-submission', 'VERIFIED', 'UNASSIGNED'],
  ]);
  const { provenance, ...original } = result.submissions[0];
  assert.deepEqual(original, {
    id: 'submission', childName: 'Submitted child', athleteId: 'athlete', measuredAt,
    measurementId: 'measurement', definitionVersion: 'PARENT_BODY_V1', hasPhoto: false,
    reviewStatus: 'RECEIVED', assignmentStatus: 'UNASSIGNED', discipline: undefined,
    values: { m1: 70, m2: 56, m3: 72, m15: 122 }, notes: 'Submitted notes',
    warnings: ['№1: 70 см (72–85 см), подтверждено родителем'], updatedAt: f.submission.updatedAt,
  });
  assert.equal(result.submissions[1].provenance.submittedAt.toISOString(), '2026-10-18T08:00:00.000Z');
  assert.deepEqual(result.drafts, [{ id: 'child', revision: 2, firstName: 'Current draft', athleteId: 'athlete' }]);
  f.state.linked = 2;
  assert.deepEqual((await f.service.dashboard('order')).submissions.map(row => [row.reviewStatus, row.assignmentStatus]), [
    ['RECEIVED', 'ASSIGNED'], ['VERIFIED', 'ASSIGNED'],
  ]);
});

test('staff projection never leaks payload contacts, credential hashes or participant data and never edits the stored submission', async () => {
  const f = fixture();
  Object.assign(f.submission.payload, { token: 'SECRET_TOKEN', email: 'SECRET_EMAIL', phone: 'SECRET_PHONE',
    photoAssetId: 'SECRET_ASSET', participant: { credentials: 'SECRET_CREDENTIAL' } });
  const before = structuredClone(f.submission);
  const result = await f.service.dashboard('order');
  assert.equal(result.submissions[0].hasPhoto, true);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_|tokenHash|credentials|operationKey|requestHash|photoAssetId/);
  assert.deepEqual(f.submission, before);
});

test('empty and unavailable order dashboards retain their existing behavior', async () => {
  const f = fixture();
  f.state.submissions = [];
  assert.deepEqual((await f.service.dashboard('order')).submissions, []);
  f.state.orderAvailable = false;
  await assert.rejects(f.service.dashboard('order'), error => error.getStatus() === 404);
});

test('the projection remains behind existing staff session and role guards', () => {
  const { ParentMeasurementsStaffController, ParentMeasurementsPublicController } =
    loadTargetModule('parent-measurements/parent-measurements.controller.ts');
  assert.deepEqual(Reflect.getMetadata('__guards__', ParentMeasurementsStaffController).map(guard => guard.name),
    ['SessionGuard', 'RolesGuard']);
  assert.deepEqual(Reflect.getMetadata('roles', ParentMeasurementsStaffController), ['OWNER', 'ADMIN', 'MANAGER']);
  assert.equal(ParentMeasurementsPublicController.prototype.dashboard, undefined);
});

test('order-created manual athlete with a pending snapshot remains in the dashboard roster after refresh', async () => {
  const f = fixture();
  f.state.submissions = [];
  f.state.athletes.push({ id: 'manual-athlete', firstName: 'Manual child', lastName: null, clientId: 'client', archivedAt: null });
  f.state.activities = [
    { orderId: 'order', type: 'ATHLETE_CREATED', metadata: { athleteId: 'manual-athlete' } },
    { orderId: 'order', type: 'MEASUREMENT_CREATED', metadata: { athleteId: 'manual-athlete', measurementId: 'pending-snapshot' } },
  ];
  const first = await f.service.dashboard('order');
  const refreshed = await f.service.dashboard('order');
  assert.deepEqual(first.manualAthleteIds, ['manual-athlete']);
  assert.deepEqual(refreshed.manualAthleteIds, ['manual-athlete']);
  assert.equal(refreshed.submissions.length, 0);
  assert.equal(refreshed.expectedPieces, 3);
  assert.equal(refreshed.athletes.find(row => row.id === 'manual-athlete').firstName, 'Manual child');
});

test('manual roster IDs require exact order activity and active client ownership, never names or all-client membership', async () => {
  const f = fixture();
  f.state.athletes.push(
    { id: 'other-order-athlete', firstName: 'Submitted child', lastName: null, clientId: 'client', archivedAt: null },
    { id: 'no-activity-athlete', firstName: 'Submitted child', lastName: null, clientId: 'client', archivedAt: null },
    { id: 'foreign-athlete', firstName: 'Submitted child', lastName: null, clientId: 'other-client', archivedAt: null },
    { id: 'archived-athlete', firstName: 'Archived', lastName: null, clientId: 'client', archivedAt: new Date() },
  );
  f.state.activities = [
    { orderId: 'order', type: 'MEASUREMENT_CREATED', metadata: { athleteId: 'athlete' } },
    { orderId: 'order', type: 'ATHLETE_CREATED', metadata: { athleteId: 'athlete' } },
    { orderId: 'other-order', type: 'ATHLETE_CREATED', metadata: { athleteId: 'other-order-athlete' } },
    { orderId: 'order', type: 'OTHER_ACTIVITY', metadata: { athleteId: 'no-activity-athlete' } },
    { orderId: 'order', type: 'ATHLETE_CREATED', metadata: { athleteId: 'foreign-athlete' } },
    { orderId: 'order', type: 'MEASUREMENT_CREATED', metadata: { athleteId: 'archived-athlete' } },
    { orderId: 'order', type: 'ATHLETE_CREATED', metadata: { athleteId: 'deleted-athlete' } },
  ];
  assert.deepEqual((await f.service.dashboard('order')).manualAthleteIds, ['athlete']);
  f.state.activities = [];
  assert.deepEqual((await f.service.dashboard('order')).manualAthleteIds, []);
});

test('missing or malformed activity metadata cannot invent roster membership or leak activity PII', async () => {
  const f = fixture();
  const metadata = [undefined, null, 'athlete', 5, true, ['athlete'], {}, { athleteId: 5 },
    { athleteId: ['athlete'] }, { firstName: 'Submitted child' },
    { athleteId: 'athlete', email: 'SECRET_EMAIL', phone: 'SECRET_PHONE', token: 'SECRET_TOKEN', measurementId: 'SECRET_MEASUREMENT' }];
  f.state.activities = metadata.map(value => ({ orderId: 'order', type: 'MEASUREMENT_CREATED',
    metadata: value, summary: 'SECRET_ACTIVITY_SUMMARY', actor: { email: 'SECRET_ACTOR_EMAIL' } }));
  const before = structuredClone(f.state.activities);
  const result = await f.service.dashboard('order');
  assert.deepEqual(result.manualAthleteIds, ['athlete']);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_|activities|manualEvents|metadata/);
  assert.deepEqual(f.state.activities, before);
});
