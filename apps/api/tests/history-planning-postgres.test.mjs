import test from 'node:test';
import assert from 'node:assert/strict';
import { historyFixture, pilotMessage, pilotOwner } from './history-migration-fixture.mjs';

test('canonical historical matching and mapped dry-run use actual isolated PostgreSQL without operational writes',
  { skip: process.env.YO_HISTORY_PGLITE !== '1', timeout: 120000 }, async t => {
    const f = await historyFixture(), q = (sql, params) => f.db.query(sql, params);
    try {
      const job = await f.stage([pilotMessage(), pilotMessage('two', { dialogueId: 'thread-b', timestamp: '2024-01-02T12:00:00Z' })]);
      await t.test('planning is separately disabled by default and owner/password boundaries are enforced', async () => {
        delete process.env.HISTORY_MIGRATION_PLANNING_ENABLED;
        await assert.rejects(f.planning.dryRun(job.jobId, pilotOwner), /не включена/);
        process.env.HISTORY_MIGRATION_PLANNING_ENABLED = 'true';
        await assert.rejects(f.planning.dryRun(job.jobId, { ...pilotOwner, id: 'other-owner' }), /другого владельца/);
        await assert.rejects(f.planning.bind(job.jobId, { mode: 'EXISTING', clientId: 'existing', dialogueId: 'thread-a' }, 'wrong', pilotOwner), /Invalid password/);
        assert.equal((await q('SELECT count(*)::int AS n FROM "HistoryMigrationTarget"')).rows[0].n, 0);
      });
      await t.test('unmapped source dialogues are not guessed by display name/order; resolve is read-only', async () => {
        const preview = await f.planning.dryRun(job.jobId, pilotOwner);
        assert.equal(preview.crmCompared, false); assert.equal(preview.review, 2); assert.equal(preview.importEnabled, false);
        const result = await f.planning.resolve(job.jobId, { dialogueId: 'thread-a', email: 'BUSINESS@EXAMPLE.TEST' }, pilotOwner);
        assert.equal(result.status, 'MATCHED'); assert.equal(result.clientId, 'existing'); assert.equal(result.persisted, false);
        assert.equal((await q('SELECT count(*)::int AS n FROM "HistoryMigrationTarget"')).rows[0].n, 0);
      });
      await t.test('password-confirmed per-dialogue targets share one client and retain source identities', async () => {
        for (const dialogueId of ['thread-a', 'thread-b']) await f.planning.bind(job.jobId, { mode: 'EXISTING', clientId: 'existing', dialogueId }, 'synthetic-password', pilotOwner);
        const preview = await f.planning.dryRun(job.jobId, pilotOwner);
        assert.equal(preview.crmCompared, true); assert.equal(preview.newCandidates, 2); assert.equal(preview.addedToCrm, 0);
        assert.deepEqual(preview.targets.map(row => row.dialogueId), ['thread-a', 'thread-b']);
        assert.equal(new Set(preview.targets.map(row => row.clientId)).size, 1);
        assert.equal((await q('SELECT count(*)::int AS n FROM "Message"')).rows[0].n, 0);
      });
      await t.test('archived targets and identity ambiguity cannot silently create or reactivate a client', async () => {
        await q(`UPDATE "Client" SET "archivedAt"=CURRENT_TIMESTAMP WHERE id='existing'`);
        const preview = await f.planning.dryRun(job.jobId, pilotOwner);
        assert.equal(preview.review, 2); assert.equal(preview.newCandidates, 0);
        await assert.rejects(f.planning.bind(job.jobId, { mode: 'EXISTING', clientId: 'existing', dialogueId: 'thread-a' }, 'synthetic-password', pilotOwner), /архивирован/);
        await q(`UPDATE "Client" SET "archivedAt"=NULL WHERE id='existing'`);
      });
      await t.test('existing hidden/draft records are included; incomplete native provenance blocks automatic additions', async () => {
        await q(`INSERT INTO "Conversation" (id,"clientId",channel,"unreadCount","lastMessageAt","updatedAt") VALUES ('old-chat','existing','INSTAGRAM',7,'2026-01-01',CURRENT_TIMESTAMP)`);
        await q(`INSERT INTO "Message" (id,"conversationId",direction,status,content,metadata,"receivedAt") VALUES ('hidden','old-chat','INBOUND','RECEIVED','Hidden retained', '{"deletion":{"deletedAt":"2026-01-02T00:00:00Z"}}','2026-01-01')`);
        const before = (await q('SELECT * FROM "Message"')).rows;
        const preview = await f.planning.dryRun(job.jobId, pilotOwner);
        assert.equal(preview.newCandidates, 0); assert.ok(preview.blockers.includes('UNVERIFIED_EXISTING_PROVENANCE'));
        assert.deepEqual((await q('SELECT * FROM "Message"')).rows, before);
        assert.equal((await q(`SELECT "unreadCount" FROM "Conversation" WHERE id='old-chat'`)).rows[0].unreadCount, 7);
      });
      await t.test('read-only preview and target controls never change financial sentinels', async () => {
        assert.equal((await q('SELECT "amountMinor" FROM "Payment"')).rows[0].amountMinor, 19500);
        assert.equal((await q('SELECT "priceMinor" FROM "Order"')).rows[0].priceMinor, 39000);
      });
    } finally { await f.close(); }
  });

test('historical reader refuses more than 10000 existing records without truncating or mutating them',
  { skip: process.env.YO_HISTORY_PGLITE !== '1', timeout: 120000 }, async () => {
    const f = await historyFixture();
    try {
      const job = await f.stage([pilotMessage()]);
      await f.planning.bind(job.jobId, { mode: 'EXISTING', clientId: 'existing', dialogueId: 'thread-a' }, 'synthetic-password', pilotOwner);
      await f.db.exec(`INSERT INTO "Conversation" (id,"clientId",channel,"updatedAt") VALUES ('large-chat','existing','INSTAGRAM',CURRENT_TIMESTAMP);
        INSERT INTO "Message" (id,"conversationId",direction,status,content) SELECT 'old-'||g,'large-chat','INBOUND','RECEIVED','Synthetic old message' FROM generate_series(1,10001) g;`);
      await assert.rejects(f.planning.dryRun(job.jobId, pilotOwner), /превышает лимит/);
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "Message"')).rows[0].n, 10001);
    } finally { await f.close(); }
  });
