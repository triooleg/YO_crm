import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { loadTargetModule } from './overview-target-loader.mjs';
import { historyFixture, pilotMessage, pilotOwner, pilotScope } from './history-migration-fixture.mjs';

const isolated = { skip: process.env.YO_HISTORY_PGLITE !== '1', timeout: 120000 };
const summaryKeys = ['jobId', 'status', 'source', 'channel', 'account', 'batchCount', 'messageCount', 'payloadBytes',
  'agentRevision', 'agentExpiresAt', 'importEnabled', 'createdAt'].sort();
const cursor = value => Buffer.from(JSON.stringify(value)).toString('base64url');

test('owner migration management lists only own jobs and exposes bounded metadata without staging secrets',
  { skip: process.env.YO_HISTORY_PGLITE !== '1', timeout: 120000 }, async () => {
    const f = await historyFixture();
    try {
      const job = await f.stage([pilotMessage(), pilotMessage('two'), pilotMessage('three', { dialogueId: 'thread-b' })]);
      const other = await f.intake.create(pilotScope, 'synthetic-password', { ...pilotOwner, id: 'other-owner' });
      const list = await f.intake.list(pilotOwner);
      assert.equal(list.jobs.length, 1); assert.equal(list.jobs[0].jobId, job.jobId); assert.equal(list.nextCursor, null);
      assert.deepEqual(Object.keys(list.jobs[0]).sort(), summaryKeys);
      assert.ok(!JSON.stringify(list).includes(other.jobId)); assert.ok(!JSON.stringify(list).includes(job.token));
      const detail = await f.intake.ownerDetail(job.jobId, pilotOwner);
      assert.deepEqual(detail.dialogs.map(row => [row.dialogueId, row.messageCount]), [['thread-a', 2], ['thread-b', 1]]);
      assert.equal(detail.agentPaired, true); assert.equal(detail.importEnabled, false);
      assert.equal(detail.planningEnabled, true); assert.equal(detail.createdAt.length, 24);
      assert.ok(!JSON.stringify(detail).includes('Synthetic one')); assert.ok(!JSON.stringify(detail).includes(job.token));
      assert.ok(!('tokenHash' in detail)); assert.ok(!('encryptedPayload' in detail));
      assert.deepEqual(Object.keys(detail).sort(), [...summaryKeys, 'agentPaired', 'planningEnabled', 'intakeLocked', 'operationalApplied', 'dialogs', 'targets'].sort());
      assert.deepEqual(detail.dialogs, [{ dialogueId: 'thread-a', channel: 'INSTAGRAM', messageCount: 2 },
        { dialogueId: 'thread-b', channel: 'INSTAGRAM', messageCount: 1 }]);
      await assert.rejects(f.intake.ownerDetail(job.jobId, { ...pilotOwner, id: 'other-owner' }), /другого владельца/);
      await assert.rejects(f.intake.list({ ...pilotOwner, role: 'ADMIN' }), /прав/);
    } finally { await f.close(); }
  });

test('owner list uses descending timestamp/id keyset pagination, max 50 and creator scope across pages', isolated, async () => {
  const f = await historyFixture();
  try {
    const ids = Array.from({ length: 55 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`);
    for (const [i, id] of ids.entries()) await f.db.query(`INSERT INTO "HistoryMigrationJob"
      (id,"createdById",source,account,channel,"createdAt","updatedAt",status)
      VALUES ($1,'owner','KEYCRM','synthetic-business','INSTAGRAM',$2,$2,'CLOSED')`,
    [id, i === 54 ? '2025-01-01T00:00:00.000Z' : '2025-01-02T00:00:00.000Z']);
    await f.intake.create(pilotScope, 'synthetic-password', { ...pilotOwner, id: 'other-owner' });
    const first = await f.intake.list(pilotOwner);
    assert.equal(first.jobs.length, 50); assert.ok(first.nextCursor.length <= 256);
    assert.deepEqual(JSON.parse(Buffer.from(first.nextCursor, 'base64url')), {
      createdAt: '2025-01-02T00:00:00.000Z', id: ids[4],
    });
    const last = await f.intake.list(pilotOwner, { cursor: first.nextCursor });
    assert.equal(last.nextCursor, null); assert.equal(last.jobs.length, 5);
    const expected = [...ids.slice(0, 54)].reverse().concat(ids[54]);
    assert.deepEqual([...first.jobs, ...last.jobs].map(row => row.jobId), expected);
    const tiny = await f.intake.list(pilotOwner, { limit: '2' });
    assert.deepEqual(tiny.jobs.map(row => row.jobId), expected.slice(0, 2));
    assert.deepEqual((await f.intake.list(pilotOwner, { limit: 2, cursor: tiny.nextCursor })).jobs.map(row => row.jobId), expected.slice(2, 4));
    for (const options of [{ limit: 0 }, { limit: 51 }, { limit: 1.5 }, { limit: '02' }, { limit: ['2'] },
      { cursor: '' }, { cursor: 'a'.repeat(257) }, { cursor: [tiny.nextCursor] }, { cursor: tiny.nextCursor + '=' },
      { cursor: cursor({ createdAt: '2025-02-30T00:00:00.000Z', id: ids[0] }) },
      { cursor: cursor({ createdAt: '0000-01-01T00:00:00.000Z', id: ids[0] }) },
      { cursor: cursor({ createdAt: '2025-01-02', id: ids[0] }) },
      { cursor: cursor({ createdAt: '2025-01-02T00:00:00.000Z', id: 'not-a-uuid' }) },
      { cursor: cursor({ createdAt: '2025-01-02T00:00:00.000Z', id: ids[0], token: 'secret' }) },
      { cursor: Buffer.from(`{"createdAt":"2025-01-02T00:00:00.000Z","id":"${ids[0]}","id":"${ids[1]}"}`).toString('base64url') },
      { createdById: 'other-owner' }]) await assert.rejects(f.intake.list(pilotOwner, options), /страниц/);
  } finally { await f.close(); }
});

test('list and detail reload active OWNER from DB and feature gating fails closed', isolated, async () => {
  const f = await historyFixture();
  try {
    const job = await f.stage([pilotMessage()]);
    for (const change of ["role='ADMIN'", 'active=false', '"archivedAt"=CURRENT_TIMESTAMP']) {
      await f.db.exec(`UPDATE "User" SET ${change} WHERE id='owner'`);
      await assert.rejects(f.intake.list(pilotOwner), /прав/);
      await assert.rejects(f.intake.ownerDetail(job.jobId, pilotOwner), /отозван/);
      await f.db.exec(`UPDATE "User" SET role='OWNER',active=true,"archivedAt"=NULL WHERE id='owner'`);
    }
    await assert.rejects(f.intake.ownerDetail('invalid', pilotOwner), /идентификатор/);
    await assert.rejects(f.intake.ownerDetail(randomUUID(), pilotOwner), /не найдено/);
    process.env.HISTORY_MIGRATION_ENABLED = 'false';
    await assert.rejects(f.intake.list(pilotOwner), /не включена/);
    await assert.rejects(f.intake.ownerDetail(job.jobId, pilotOwner), /не включена/);
  } finally { await f.close(); }
});

test('detail exposes active target metadata only when planning enabled and pairing reflects revoke/expiry/close', isolated, async () => {
  const f = await historyFixture();
  try {
    const job = await f.stage([pilotMessage()]);
    const bound = await f.planning.bind(job.jobId, { dialogueId: 'thread-a', mode: 'EXISTING', clientId: 'existing' }, 'synthetic-password', pilotOwner);
    assert.deepEqual((await f.intake.ownerDetail(job.jobId, pilotOwner)).targets, [{ targetId: bound.targetId,
      dialogueId: 'thread-a', mode: 'EXISTING', clientId: 'existing', revision: 1 }]);
    process.env.HISTORY_MIGRATION_PLANNING_ENABLED = 'false';
    // A dropped planning table proves the disabled route does not read it.
    await f.db.exec('ALTER TABLE "HistoryMigrationTarget" RENAME TO "DisabledPlanningTarget"');
    const disabled = await f.intake.ownerDetail(job.jobId, pilotOwner);
    assert.equal(disabled.planningEnabled, false); assert.deepEqual(disabled.targets, []);
    await f.db.exec('ALTER TABLE "DisabledPlanningTarget" RENAME TO "HistoryMigrationTarget"');
    process.env.HISTORY_MIGRATION_PLANNING_ENABLED = 'true';
    await f.db.exec('UPDATE "HistoryMigrationTarget" SET "archivedAt"=CURRENT_TIMESTAMP');
    assert.deepEqual((await f.intake.ownerDetail(job.jobId, pilotOwner)).targets, []);
    await f.intake.revoke(job.jobId, 'synthetic-password', pilotOwner);
    assert.equal((await f.intake.ownerDetail(job.jobId, pilotOwner)).agentPaired, false);
    await f.intake.pair(job.jobId, 'synthetic-password', pilotOwner);
    await f.db.exec(`UPDATE "HistoryMigrationJob" SET "agentExpiresAt"='2000-01-01'`);
    assert.equal((await f.intake.ownerDetail(job.jobId, pilotOwner)).agentPaired, false);
    await f.intake.revoke(job.jobId, 'synthetic-password', pilotOwner, true);
    assert.equal((await f.intake.ownerDetail(job.jobId, pilotOwner)).status, 'CLOSED');
  } finally { await f.close(); }
});

test('detail refuses inconsistent counters and corrupt staged ciphertext instead of returning partial metadata', isolated, async () => {
  const f = await historyFixture();
  try {
    const job = await f.stage([pilotMessage()]);
    for (const column of ['messageCount', 'batchCount', 'payloadBytes']) {
      await f.db.exec(`UPDATE "HistoryMigrationJob" SET "${column}"="${column}"+1`);
      await assert.rejects(f.intake.ownerDetail(job.jobId, pilotOwner), /Счётчики/);
      await f.db.exec(`UPDATE "HistoryMigrationJob" SET "${column}"="${column}"-1`);
    }
    await f.db.exec('UPDATE "HistoryMigrationBatch" SET "encryptedPayload"=\'corrupt\'');
    await assert.rejects(f.intake.ownerDetail(job.jobId, pilotOwner));
  } finally { await f.close(); }
});

test('owner metadata routes enforce session and OWNER guards, no-store and bounded queries through actual Nest HTTP', isolated, async () => {
  const require = createRequire(import.meta.url);
  const { NestFactory, Reflector } = require('@nestjs/core');
  const { Module, UnauthorizedException } = require('@nestjs/common');
  const { HistoryMigrationController } = loadTargetModule('history-migration/history-migration.controller.ts');
  const { HistoryMigrationService } = loadTargetModule('history-migration/history-migration.service.ts');
  const { SessionGuard } = loadTargetModule('auth/session.guard.ts');
  const { AuthService } = loadTargetModule('auth/auth.service.ts');
  const { RolesGuard } = loadTargetModule('auth/roles.guard.ts');
  const { historyMigrationBodyParser } = loadTargetModule('history-migration/history-migration-security.ts');
  const f = await historyFixture();
  let app;
  const beforeProxy = process.env.HISTORY_MIGRATION_TRUSTED_PROXIES;
  try {
    const job = await f.stage([pilotMessage()]);
    // This source loader omits compiler-emitted constructor metadata; restore
    // the same token emitted by the real Nest TypeScript build.
    Reflect.defineMetadata('design:paramtypes', [HistoryMigrationService], HistoryMigrationController);
    Reflect.defineMetadata('design:paramtypes', [AuthService], SessionGuard);
    Reflect.defineMetadata('design:paramtypes', [Reflector], RolesGuard);
    const auth = { userForToken: async token => {
      if (!['owner', 'other-owner', 'admin'].includes(token)) throw new UnauthorizedException();
      return { ...pilotOwner, id: token, role: token === 'admin' ? 'ADMIN' : 'OWNER' };
    } };
    class OwnerHttpFixture {}
    Module({ controllers: [HistoryMigrationController], providers: [
      { provide: HistoryMigrationService, useValue: f.intake },
      { provide: AuthService, useValue: auth },
      { provide: SessionGuard, useValue: new SessionGuard(auth) },
      { provide: RolesGuard, useValue: new RolesGuard(new Reflector()) },
    ] })(OwnerHttpFixture);
    app = await NestFactory.create(OwnerHttpFixture, { logger: false, abortOnError: false, bodyParser: false });
    app.use('/api/admin/history-migration', ...historyMigrationBodyParser('16kb'));
    app.use(require('cookie-parser')()); app.setGlobalPrefix('api');
    await app.listen(0, '127.0.0.1');
    const root = await app.getUrl();
    process.env.HISTORY_MIGRATION_TRUSTED_PROXIES = '127.0.0.1';
    const get = (suffix, session) => fetch(`${root}/api/admin/history-migration/jobs${suffix}`, {
      headers: { 'X-Forwarded-Proto': 'https', Authorization: `Bearer ${job.token}`,
        ...(session ? { Cookie: `yoleotard_crm_session=${session}` } : {}) }, redirect: 'error',
    });
    for (const suffix of ['', `/${job.jobId}`]) {
      assert.equal((await get(suffix)).status, 401);
      assert.equal((await get(suffix, 'admin')).status, 403);
      const response = await get(suffix, 'owner');
      assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      const body = await response.text(); assert.ok(!body.includes(job.token)); assert.ok(!body.includes('Synthetic one'));
    }
    assert.equal((await get(`/${job.jobId}`, 'other-owner')).status, 403);
    assert.equal((await get('?limit=51', 'owner')).status, 400);
    assert.equal((await get('?limit=1&limit=2', 'owner')).status, 400);
    assert.equal((await get('?token=secret', 'owner')).status, 400);
    assert.equal((await get('?limit=1', 'owner')).status, 200);
  } finally {
    await app?.close(); await f.close();
    if (beforeProxy === undefined) delete process.env.HISTORY_MIGRATION_TRUSTED_PROXIES;
    else process.env.HISTORY_MIGRATION_TRUSTED_PROXIES = beforeProxy;
  }
});
