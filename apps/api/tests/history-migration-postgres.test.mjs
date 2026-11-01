import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { loadTargetModule } from './overview-target-loader.mjs';

const enabled = process.env.YO_HISTORY_PGLITE === '1';
const hash = text => createHash('sha256').update(text).digest('hex');
const scope = { source: 'KEYCRM', account: 'synthetic-business', channel: 'INSTAGRAM' };
const makePacket = (id = 'm1', extra = {}) => {
  const payloadJson = JSON.stringify({ version: 1, source: 'KEYCRM', completeness: { status: 'PARTIAL' }, messages: [{ ...scope,
    dialogueId: 'synthetic-thread', sourceMessageId: id, sender: 'synthetic-customer', direction: 'INBOUND',
    timestamp: '2024-02-29T10:00:00+02:00', text: 'SYNTHETIC HISTORY ONLY', ordinal: 0, attachments: [], ...extra }] });
  return { batchId: randomUUID(), checksum: hash(payloadJson), payloadJson };
};

test('history staging: actual SQL repository and service against isolated in-memory PostgreSQL', { skip: !enabled, timeout: 120000 }, async t => {
  // Explicit local WASM PostgreSQL only. Never consumes DATABASE_URL or opens a server socket.
  const { PGlite } = await import('../../../.local/tracking-notifications/pg-test/node_modules/@electric-sql/pglite/dist/index.js');
  const db = new PGlite();
  const { HistoryMigrationRepository } = loadTargetModule('history-migration/history-migration.repository.ts');
  const { HistoryMigrationService } = loadTargetModule('history-migration/history-migration.service.ts');
  const flags = { enabled: process.env.HISTORY_MIGRATION_ENABLED, key: process.env.SETTINGS_ENCRYPTION_KEY };
  process.env.HISTORY_MIGRATION_ENABLED = 'true'; process.env.SETTINGS_ENCRYPTION_KEY = 'synthetic-local-key-not-a-production-secret-2026';
  const owner = { id: 'owner', role: 'OWNER', active: true, archivedAt: null };
  // Prisma's tagged SQL port is executed verbatim with positional PostgreSQL binds.
  const sqlPort = query => ({
    $queryRaw: async (parts, ...values) => (await query(parts.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, ''), values)).rows,
    $executeRaw: async (parts, ...values) => (await query(parts.reduce((s, part, i) => s + (i ? `$${i}` : '') + part, ''), values)).affectedRows,
  });
  let rejectCommit = false;
  const prisma = { $transaction: callback => db.transaction(async pg => {
    const result = await callback(sqlPort((text, values) => pg.query(text, values)));
    if (rejectCommit) throw new Error('Synthetic commit failure');
    return result;
  }) };
  const reauthCalls = [];
  let rotateAfterAuthentication = false;
  const backups = { reauthenticate: async (actor, password) => {
    reauthCalls.push(actor.id); if (password !== 'synthetic-password') throw new Error('Bad password');
    const current = (await db.query('SELECT * FROM "User" WHERE id=$1', [actor.id])).rows[0];
    if (rotateAfterAuthentication) await db.query('UPDATE "User" SET "passwordHash"=$1 WHERE id=$2', ['rotated-password-hash', actor.id]);
    return current;
  } };
  const repository = new HistoryMigrationRepository(prisma), service = new HistoryMigrationService(repository, backups);
  const query = (text, values) => db.query(text, values);
  const count = async table => (await query(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n;
  let job, token, first;
  try {
    await db.exec(`CREATE TABLE "User" (id TEXT PRIMARY KEY, role TEXT NOT NULL, active BOOLEAN NOT NULL, "archivedAt" TIMESTAMP(3),"passwordHash" TEXT DEFAULT 'synthetic-password-hash');
      CREATE TABLE "AuditLog" (id TEXT PRIMARY KEY,"actorId" TEXT REFERENCES "User"(id),action TEXT,"entityType" TEXT,"entityId" TEXT,"after" JSONB,"createdAt" TIMESTAMP(3));
      CREATE TABLE "Message" (id TEXT PRIMARY KEY,content TEXT,"sentAt" TIMESTAMP(3));
      CREATE TABLE "Client" (id TEXT PRIMARY KEY,name TEXT);
      CREATE TABLE "Payment" (id TEXT PRIMARY KEY,"amountMinor" INTEGER);
      INSERT INTO "User" (id,role,active,"archivedAt") VALUES ('owner','OWNER',true,NULL),('other-owner','OWNER',true,NULL);
      INSERT INTO "Message" VALUES ('original','Preserve live history','2026-10-01');
      INSERT INTO "Client" VALUES ('original','Preserve client'); INSERT INTO "Payment" VALUES ('original',19500);`);
    const original = {};
    for (const table of ['Message', 'Client', 'Payment']) original[table] = (await query(`SELECT * FROM "${table}"`)).rows;
    await db.exec(await readFile(new URL('../../../packages/database/prisma/migrations/20261029150000_history_migration_staging/migration.sql', import.meta.url), 'utf8'));
    await t.test('disabled by default and fresh-password gated; active role is rechecked in SQL', async () => {
      delete process.env.HISTORY_MIGRATION_ENABLED;
      await assert.rejects(service.create(scope, 'synthetic-password', owner), /не включена/);
      process.env.HISTORY_MIGRATION_ENABLED = 'true';
      await assert.rejects(service.create(scope, 'wrong', owner), /Bad password/);
      await query(`UPDATE "User" SET role='MANAGER' WHERE id='owner'`);
      await assert.rejects(service.create(scope, 'synthetic-password', owner), /прав/);
      await query(`UPDATE "User" SET role='OWNER' WHERE id='owner'`);
      job = await service.create(scope, 'synthetic-password', owner);
      assert.equal(job.importEnabled, false); assert.equal(job.batchCount, 0);
      const paired = await service.pair(job.jobId, 'synthetic-password', owner); token = paired.token;
      const stored = (await query('SELECT * FROM "HistoryMigrationJob"')).rows[0];
      assert.equal(stored.tokenHash, hash(token)); assert.ok(!JSON.stringify(stored).includes(token));
      assert.equal(paired.importEnabled, false); assert.ok(reauthCalls.length >= 4);
    });
    await t.test('scoped status excludes stored data; bad token and other owner cannot read or rotate', async () => {
      assert.deepEqual(await service.status(job.jobId, `Bearer ${token}`), { jobId: job.jobId, status: 'STAGING', importEnabled: false });
      await assert.rejects(service.status(job.jobId, `Bearer ${'a'.repeat(43)}`), /недействителен/);
      await assert.rejects(service.preview(job.jobId, { ...owner, id: 'other-owner' }), /другого владельца/);
      await assert.rejects(service.pair(job.jobId, 'synthetic-password', { ...owner, id: 'other-owner' }), /другого владельца/);
      await assert.rejects(service.stage(job.jobId, `Bearer ${token}`, makePacket('foreign', { account: 'other' })), /Неверный пакет/);
    });
    await t.test('password rotation between verification and mutation rejects create, pair and revoke without writes', async () => {
      for (const operation of [() => service.create(scope, 'synthetic-password', owner),
        () => service.pair(job.jobId, 'synthetic-password', owner),
        () => service.revoke(job.jobId, 'synthetic-password', owner)]) {
        await query(`UPDATE "User" SET "passwordHash"='synthetic-password-hash' WHERE id='owner'`);
        const before = (await query('SELECT * FROM "HistoryMigrationJob" ORDER BY id')).rows;
        const beforeAudit = await count('AuditLog'); rotateAfterAuthentication = true;
        await assert.rejects(operation(), /повторите подтверждение/);
        rotateAfterAuthentication = false;
        assert.deepEqual((await query('SELECT * FROM "HistoryMigrationJob" ORDER BY id')).rows, before);
        assert.equal(await count('AuditLog'), beforeAudit);
      }
      await query(`UPDATE "User" SET "passwordHash"='synthetic-password-hash' WHERE id='owner'`);
    });
    await t.test('ACK follows encrypted data and audit COMMIT, failure produces no ACK or partial changes', async () => {
      first = makePacket(); rejectCommit = true;
      await assert.rejects(service.stage(job.jobId, `Bearer ${token}`, first), /Synthetic commit failure/);
      rejectCommit = false; assert.equal(await count('HistoryMigrationBatch'), 0);
      const ack = await service.stage(job.jobId, `Bearer ${token}`, first);
      assert.deepEqual(ack, { jobId: job.jobId, batchId: first.batchId, checksum: first.checksum, status: 'STAGED' });
      const [row] = (await query('SELECT * FROM "HistoryMigrationBatch"')).rows;
      assert.ok(row.encryptedPayload.startsWith('v1.')); assert.ok(!row.encryptedPayload.includes('SYNTHETIC HISTORY'));
      const audits = (await query(`SELECT * FROM "AuditLog" WHERE action='HISTORY_BATCH_STAGED'`)).rows;
      assert.equal(audits.length, 1); assert.ok(!JSON.stringify(audits).includes('SYNTHETIC HISTORY'));
    });
    await t.test('lost ACK retries and concurrent retries stay idempotent; conflicts are rejected', async () => {
      const acks = await Promise.all(Array.from({ length: 4 }, () => service.stage(job.jobId, `Bearer ${token}`, first)));
      assert.ok(acks.every(a => a.checksum === first.checksum)); assert.equal(await count('HistoryMigrationBatch'), 1);
      assert.equal((await service.preview(job.jobId, owner)).batchCount, 1);
      await assert.rejects(service.stage(job.jobId, `Bearer ${token}`, { ...first, ...makePacket('changed'), batchId: first.batchId }), /уже использовано/);
      await assert.rejects(service.stage(job.jobId, `Bearer ${token}`, { ...first, batchId: randomUUID() }), /уже использовано/);
      const duplicate = makePacket('m1'); const parsed = JSON.parse(duplicate.payloadJson); parsed.messages[0].ordinal = 1;
      duplicate.payloadJson = JSON.stringify(parsed); duplicate.checksum = hash(duplicate.payloadJson);
      await service.stage(job.jobId, `Bearer ${token}`, duplicate);
      const preview = await service.preview(job.jobId, owner);
      assert.equal(preview.discovered, 2); assert.equal(preview.inBatchDuplicates, 1);
      assert.equal(preview.crmCompared, false); assert.equal(preview.addedToCrm, 0); assert.equal(preview.requiresReview, 1);
      assert.equal(preview.importEnabled, false); assert.equal(preview.sourceCompleteness, 'UNVERIFIED');
    });
    await t.test('restarted service recovers durable staged packets; quota and SQL uniqueness preserve counters', async () => {
      const restarted = new HistoryMigrationService(new HistoryMigrationRepository(prisma), backups);
      assert.equal((await restarted.preview(job.jobId, owner)).batchCount, 2);
      await query(`UPDATE "HistoryMigrationJob" SET "messageCount"=1000 WHERE id=$1`, [job.jobId]);
      await assert.rejects(restarted.stage(job.jobId, `Bearer ${token}`, makePacket('quota')), /лимит/);
      await query(`UPDATE "HistoryMigrationJob" SET "messageCount"=2 WHERE id=$1`, [job.jobId]);
      await assert.rejects(query(`DELETE FROM "HistoryMigrationJob" WHERE id=$1`, [job.jobId]), e => ['23503','23001'].includes(e.code));
      assert.equal(await count('HistoryMigrationBatch'), 2);
    });
    await t.test('ciphertext is authenticated to its own job and batch even for identical source payloads', async () => {
      const other = await service.create(scope, 'synthetic-password', owner);
      const otherToken = (await service.pair(other.jobId, 'synthetic-password', owner)).token;
      const otherPacket = { ...first, batchId: randomUUID() };
      await service.stage(other.jobId, `Bearer ${otherToken}`, otherPacket);
      const original = (await query('SELECT "encryptedPayload" FROM "HistoryMigrationBatch" WHERE "jobId"=$1 AND "batchId"=$2', [job.jobId, first.batchId])).rows[0].encryptedPayload;
      const foreign = (await query('SELECT "encryptedPayload" FROM "HistoryMigrationBatch" WHERE "jobId"=$1', [other.jobId])).rows[0].encryptedPayload;
      await query('UPDATE "HistoryMigrationBatch" SET "encryptedPayload"=$1 WHERE "jobId"=$2 AND "batchId"=$3', [foreign, job.jobId, first.batchId]);
      await assert.rejects(service.preview(job.jobId, owner), /привязка пакета/);
      await query('UPDATE "HistoryMigrationBatch" SET "encryptedPayload"=$1 WHERE "jobId"=$2 AND "batchId"=$3', [original, job.jobId, first.batchId]);
      await service.revoke(other.jobId, 'synthetic-password', owner, true);
    });
    await t.test('revocation, expiry and role changes reject credentials inside locked transaction', async () => {
      await service.revoke(job.jobId, 'synthetic-password', owner);
      await assert.rejects(service.stage(job.jobId, `Bearer ${token}`, makePacket('revoked')), /недействителен/);
      token = (await service.pair(job.jobId, 'synthetic-password', owner)).token;
      await query(`UPDATE "HistoryMigrationJob" SET "agentExpiresAt"='2000-01-01' WHERE id=$1`, [job.jobId]);
      await assert.rejects(service.status(job.jobId, `Bearer ${token}`), /недействителен/);
      token = (await service.pair(job.jobId, 'synthetic-password', owner)).token;
      await query(`UPDATE "User" SET active=false WHERE id='owner'`);
      await assert.rejects(service.stage(job.jobId, `Bearer ${token}`, makePacket('inactive')), /отозван/);
      await query(`UPDATE "User" SET active=true WHERE id='owner'`);
      await service.revoke(job.jobId, 'synthetic-password', owner, true);
      await assert.rejects(service.pair(job.jobId, 'synthetic-password', owner), /закрыто/);
      await assert.rejects(service.stage(job.jobId, `Bearer ${token}`, makePacket('closed')), /закрыто/);
      assert.equal((await service.preview(job.jobId, owner)).status, 'CLOSED');
    });
    await t.test('all operational history, clients and payments remain byte-for-byte unchanged', async () => {
      for (const table of ['Message', 'Client', 'Payment']) assert.deepEqual((await query(`SELECT * FROM "${table}"`)).rows, original[table]);
    });
  } finally {
    await db.close();
    for (const [name, value] of [['HISTORY_MIGRATION_ENABLED', flags.enabled], ['SETTINGS_ENCRYPTION_KEY', flags.key]])
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});
