import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargetModule } from './overview-target-loader.mjs';
import { historyFixture, pilotMessage, pilotOwner } from './history-migration-fixture.mjs';

test('isolated historical append, replay and selective rollback preserve current CRM state',
  { skip: process.env.YO_HISTORY_PGLITE !== '1', timeout: 120000 }, async t => {
    const { IsolatedHistoryMigrationPilot } = loadTargetModule('history-migration/isolated-history-pilot.ts');
    const f = await historyFixture(), q = (sql, params) => f.db.query(sql, params);
    const pilot = new IsolatedHistoryMigrationPilot(f.repository, f.backups);
    let job, run;
    try {
      job = await f.stage([pilotMessage(), pilotMessage('two', { dialogueId: 'thread-b', timestamp: '2024-01-02T12:00:00Z', direction: 'OUTBOUND' })]);
      for (const dialogueId of ['thread-a', 'thread-b']) await f.planning.bind(job.jobId, { dialogueId, mode: 'EXISTING', clientId: 'existing' }, 'synthetic-password', pilotOwner);
      await t.test('real PostgreSQL is refused before any service mutation; only actual WASM can write', async () => {
        const preview = await f.planning.dryRun(job.jobId, pilotOwner);
        f.realPostgres(true);
        await assert.rejects(pilot.apply(job.jobId, preview.previewDigest, 'synthetic-password', pilotOwner), /WASM/);
        f.realPostgres(false);
        assert.equal((await q('SELECT count(*)::int AS n FROM "Message"')).rows[0].n, 0);
        assert.equal((await q('SELECT count(*)::int AS n FROM "HistoryMigrationPilotRun"')).rows[0].n, 0);
      });
      await t.test('approved exact-time text inserts original chronology, origins and run in one transaction', async () => {
        const preview = await f.planning.dryRun(job.jobId, pilotOwner);
        f.failCommit(true);
        await assert.rejects(pilot.apply(job.jobId, preview.previewDigest, 'synthetic-password', pilotOwner), /Synthetic transaction failure/);
        f.failCommit(false);
        assert.equal((await q('SELECT count(*)::int AS n FROM "Message"')).rows[0].n, 0);
        run = await pilot.apply(job.jobId, preview.previewDigest, 'synthetic-password', pilotOwner);
        assert.equal(run.added, 2); assert.equal(run.createdClients, 0); assert.equal(run.productionImport, false);
        const rows = (await q('SELECT * FROM "Message" ORDER BY "createdAt"')).rows;
        assert.equal(rows[0].createdAt.toISOString(), '2024-01-01T12:00:00.000Z');
        assert.equal(rows[1].sentAt.toISOString(), '2024-01-02T12:00:00.000Z');
        assert.equal(rows[0].content, 'Synthetic one'); assert.ok(rows.every(row => row.aiProcessedAt === null && row.aiAnalysisVersion === null));
        for (const table of ['AiJob', 'AiJobAttempt', 'MessageAnalysis']) assert.equal((await q(`SELECT count(*)::int AS n FROM "${table}"`)).rows[0].n, 0);
        assert.equal((await q('SELECT "unreadCount" FROM "Conversation"')).rows[0].unreadCount, 0);
      });
      await t.test('same source rerun is idempotent; source dialogues remain separate provenance records', async () => {
        const before = (await q('SELECT * FROM "Message" ORDER BY id')).rows;
        const preview = await f.planning.dryRun(job.jobId, pilotOwner);
        assert.equal(preview.alreadyExists, 2); assert.equal(preview.newCandidates, 0);
        const repeated = await pilot.apply(job.jobId, preview.previewDigest, 'synthetic-password', pilotOwner);
        assert.equal(repeated.replayed, true); assert.equal(repeated.added, 0);
        assert.deepEqual((await q('SELECT * FROM "Message" ORDER BY id')).rows, before);
        assert.equal((await q('SELECT count(*)::int AS n FROM "HistoryMigrationOrigin"')).rows[0].n, 2);
        assert.equal((await q('SELECT count(*)::int AS n FROM "Conversation"')).rows[0].n, 1);
      });
      await t.test('manual tombstone blocks replay even with the previously approved digest', async () => {
        const [before] = (await q('SELECT id,metadata FROM "Message" ORDER BY id LIMIT 1')).rows;
        await q(`UPDATE "Message" SET metadata=metadata || '{"deletion":{"deletedAt":"2026-01-01T00:00:00Z"}}'::jsonb WHERE id=$1`, [before.id]);
        const current = await f.planning.dryRun(job.jobId, pilotOwner);
        assert.equal(current.review, 1);
        const [oldRun] = (await q('SELECT "previewDigest" FROM "HistoryMigrationPilotRun" WHERE id=$1', [run.runId])).rows;
        await assert.rejects(pilot.apply(job.jobId, oldRun.previewDigest, 'synthetic-password', pilotOwner), /изменилось|замечания/);
        await q('UPDATE "Message" SET metadata=$1::jsonb WHERE id=$2', [JSON.stringify(before.metadata), before.id]);
      });
      await t.test('a new dependency blocks the whole rollback; no partial tombstones are written', async () => {
        const [message] = (await q('SELECT id FROM "Message" ORDER BY id LIMIT 1')).rows;
        await q('INSERT INTO "WorkTask" (id,"sourceMessageId") VALUES ($1,$2)', ['new-dependent-task', message.id]);
        await assert.rejects(pilot.rollback(job.jobId, run.runId, 'synthetic-password', pilotOwner), /изменилось|зависимост/);
        assert.equal((await q(`SELECT count(*)::int AS n FROM "Message" WHERE metadata #>> '{deletion,deletedAt}' IS NOT NULL`)).rows[0].n, 0);
        await q(`DELETE FROM "WorkTask" WHERE id='new-dependent-task'`);
      });
      await t.test('rollback hides only run-created messages, retains content/dates/origins and prevents resurrection', async () => {
        const original = (await q('SELECT id,content,"createdAt","sentAt","receivedAt" FROM "Message" ORDER BY id')).rows;
        await pilot.rollback(job.jobId, run.runId, 'synthetic-password', pilotOwner);
        assert.deepEqual((await q('SELECT id,content,"createdAt","sentAt","receivedAt" FROM "Message" ORDER BY id')).rows, original);
        assert.equal((await q(`SELECT count(*)::int AS n FROM "Message" WHERE metadata #>> '{deletion,deletedAt}' IS NOT NULL`)).rows[0].n, 2);
        const preview = await f.planning.dryRun(job.jobId, pilotOwner);
        assert.equal(preview.newCandidates, 0); assert.ok(preview.blockers.includes('PREVIOUS_IMPORT_ROLLED_BACK'));
        await assert.rejects(pilot.apply(job.jobId, preview.previewDigest, 'synthetic-password', pilotOwner), /отозван/);
        assert.equal((await q('SELECT count(*)::int AS n FROM "HistoryMigrationOrigin"')).rows[0].n, 2);
      });
      await t.test('client/order/payment sentinels are preserved', async () => {
        assert.equal((await q(`SELECT status,"archivedAt" FROM "Client" WHERE id='existing'`)).rows[0].status, 'ACTIVE');
        assert.equal((await q(`SELECT "archivedAt" FROM "Client" WHERE id='existing'`)).rows[0].archivedAt, null);
        assert.equal((await q('SELECT "amountMinor" FROM "Payment"')).rows[0].amountMinor, 19500);
        assert.equal((await q('SELECT "priceMinor" FROM "Order"')).rows[0].priceMinor, 39000);
      });
    } finally { await f.close(); }
  });

test('isolated rollback archives only a pristine newly created client and refuses automatic recreation',
  { skip: process.env.YO_HISTORY_PGLITE !== '1', timeout: 120000 }, async () => {
    const { IsolatedHistoryMigrationPilot } = loadTargetModule('history-migration/isolated-history-pilot.ts');
    const f = await historyFixture(), pilot = new IsolatedHistoryMigrationPilot(f.repository, f.backups);
    try {
      const job = await f.stage([pilotMessage('missing-client')]);
      await f.planning.bind(job.jobId, { mode: 'CREATE_PROPOSAL', dialogueId: 'thread-a', subjectId: 'unique-owner-confirmed-id', displayName: 'Synthetic missing client' }, 'synthetic-password', pilotOwner);
      const run = await pilot.apply(job.jobId, (await f.planning.dryRun(job.jobId, pilotOwner)).previewDigest, 'synthetic-password', pilotOwner);
      assert.equal(run.createdClients, 1);
      await pilot.rollback(job.jobId, run.runId, 'synthetic-password', pilotOwner);
      const clients = (await f.db.query('SELECT * FROM "Client" ORDER BY id')).rows;
      assert.equal(clients.length, 2); assert.equal(clients.find(c => c.id === 'existing').archivedAt, null);
      assert.ok(clients.find(c => c.id !== 'existing').archivedAt);
      const preview = await f.planning.dryRun(job.jobId, pilotOwner);
      assert.equal(preview.targets[0].state, 'REVIEW'); assert.equal(preview.newCandidates, 0);
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "HistoryMigrationIdentity"')).rows[0].n, 1);
    } finally { await f.close(); }
  });

test('canonical Unicode source variants replay exactly, while unverified enrichment cannot be silently skipped',
  { skip: process.env.YO_HISTORY_PGLITE !== '1', timeout: 120000 }, async t => {
    const { IsolatedHistoryMigrationPilot } = loadTargetModule('history-migration/isolated-history-pilot.ts');
    const f = await historyFixture(), pilot = new IsolatedHistoryMigrationPilot(f.repository, f.backups);
    try {
      for (const [index, variants] of [['Café', 'Cafe\u0301'], ['Cafe\u0301', 'Café']].entries()) {
        await t.test(`NFC/NFD source variants ordering ${index + 1} preserves chosen bytes and fresh replay`, async () => {
          const messages = variants.map((text, ordinal) => pilotMessage(`unicode-${index}`, { text, ordinal, timestamp: `2024-01-0${index + 1}T12:00:00Z` }));
          const job = await f.stage(messages);
          await f.planning.bind(job.jobId, { mode: 'EXISTING', dialogueId: 'thread-a', clientId: 'existing' }, 'synthetic-password', pilotOwner);
          const preview = await f.planning.dryRun(job.jobId, pilotOwner);
          const run = await pilot.apply(job.jobId, preview.previewDigest, 'synthetic-password', pilotOwner);
          assert.equal(run.added, 1);
          const current = await f.planning.dryRun(job.jobId, pilotOwner);
          assert.equal(current.alreadyExists, 1); assert.equal(current.conflicts, 0);
          const repeated = await pilot.apply(job.jobId, current.previewDigest, 'synthetic-password', pilotOwner);
          assert.equal(repeated.added, 0);
        });
      }
      await t.test('existing source ID plus media addition is review-required and cannot produce a successful silent run', async () => {
        const job = await f.stage([pilotMessage('unicode-0', { text: 'Café', attachments: [{ checksum: 'a'.repeat(64), name: 'synthetic.jpg', mimeType: 'image/jpeg', size: 10, available: true }] })]);
        await f.planning.bind(job.jobId, { mode: 'EXISTING', dialogueId: 'thread-a', clientId: 'existing' }, 'synthetic-password', pilotOwner);
        const before = (await f.db.query('SELECT * FROM "Message" ORDER BY id')).rows;
        const runsBefore = (await f.db.query('SELECT count(*)::int AS n FROM "HistoryMigrationPilotRun"')).rows[0].n;
        const preview = await f.planning.dryRun(job.jobId, pilotOwner);
        assert.equal(preview.review, 1); assert.ok(preview.blockers.includes('MESSAGE_REVIEW_REQUIRED'));
        await assert.rejects(pilot.apply(job.jobId, preview.previewDigest, 'synthetic-password', pilotOwner), /замечания/);
        assert.deepEqual((await f.db.query('SELECT * FROM "Message" ORDER BY id')).rows, before);
        assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "HistoryMigrationPilotRun"')).rows[0].n, runsBefore);
      });
    } finally { await f.close(); }
  });

test('missing client is created once from approved source identity and old exact history is appended without current-state changes',
  { skip: process.env.YO_HISTORY_PGLITE !== '1', timeout: 120000 }, async t => {
    const { IsolatedHistoryMigrationPilot } = loadTargetModule('history-migration/isolated-history-pilot.ts');
    const f = await historyFixture(), q = (sql, params) => f.db.query(sql, params), pilot = new IsolatedHistoryMigrationPilot(f.repository, f.backups);
    let firstRun, firstJob, newClientId;
    try {
      firstJob = await f.stage([pilotMessage('first'), pilotMessage('second', { dialogueId: 'thread-b', timestamp: '2024-01-02T12:00:00Z' })]);
      for (const dialogueId of ['thread-a', 'thread-b']) await f.planning.bind(firstJob.jobId,
        { mode: 'CREATE_PROPOSAL', dialogueId, subjectId: 'owner-confirmed-subject', displayName: 'Synthetic new client' }, 'synthetic-password', pilotOwner);
      await t.test('two dialogues create one new client and scoped identity; existing clients remain untouched', async () => {
        const preview = await f.planning.dryRun(firstJob.jobId, pilotOwner);
        assert.equal(preview.targets.every(target => target.state === 'CREATE_PROPOSAL'), true);
        firstRun = await pilot.apply(firstJob.jobId, preview.previewDigest, 'synthetic-password', pilotOwner);
        assert.equal(firstRun.createdClients, 1); assert.equal(firstRun.added, 2);
        const [identity] = (await q('SELECT * FROM "HistoryMigrationIdentity"')).rows; newClientId = identity.clientId;
        assert.equal((await q('SELECT count(*)::int AS n FROM "Client"')).rows[0].n, 2);
        const repeated = await pilot.apply(firstJob.jobId, (await f.planning.dryRun(firstJob.jobId, pilotOwner)).previewDigest, 'synthetic-password', pilotOwner);
        assert.equal(repeated.added, 0); assert.equal(repeated.createdClients, 0);
      });
      await t.test('same source IDs cannot be reassigned to another client by a different job', async () => {
        const wrong = await f.stage([pilotMessage('first')]);
        await f.planning.bind(wrong.jobId, { mode: 'EXISTING', dialogueId: 'thread-a', clientId: 'existing' }, 'synthetic-password', pilotOwner);
        const preview = await f.planning.dryRun(wrong.jobId, pilotOwner);
        assert.equal(preview.newCandidates, 0); assert.equal(preview.review, 1);
        await assert.rejects(pilot.apply(wrong.jobId, preview.previewDigest, 'synthetic-password', pilotOwner), /замечания/);
      });
      await t.test('older newly found text does not alter old message fields, balances or Inbox attention', async () => {
        const [conversation] = (await q('SELECT * FROM "Conversation" WHERE "clientId"=$1', [newClientId])).rows;
        await q('UPDATE "Conversation" SET "unreadCount"=7,"unreadVersion"=9,"lastMessageAt"=$1 WHERE id=$2', ['2026-01-01', conversation.id]);
        const beforeConversation = (await q('SELECT * FROM "Conversation" WHERE id=$1', [conversation.id])).rows;
        const beforeMessages = (await q('SELECT * FROM "Message" ORDER BY id')).rows;
        const older = await f.stage([pilotMessage('older', { timestamp: '2023-12-01T10:00:00Z' })]);
        await f.planning.bind(older.jobId, { mode: 'EXISTING', dialogueId: 'thread-a', clientId: newClientId }, 'synthetic-password', pilotOwner);
        const preview = await f.planning.dryRun(older.jobId, pilotOwner);
        assert.equal(preview.newCandidates, 1); assert.equal(preview.review, 0);
        const run = await pilot.apply(older.jobId, preview.previewDigest, 'synthetic-password', pilotOwner);
        assert.equal(run.added, 1);
        for (const message of beforeMessages) assert.deepEqual((await q('SELECT * FROM "Message" WHERE id=$1', [message.id])).rows[0], message);
        assert.deepEqual((await q('SELECT * FROM "Conversation" WHERE id=$1', [conversation.id])).rows, beforeConversation);
        assert.equal((await q('SELECT "createdAt" FROM "Message" ORDER BY "createdAt" LIMIT 1')).rows[0].createdAt.toISOString(), '2023-12-01T10:00:00.000Z');
        await pilot.rollback(older.jobId, run.runId, 'synthetic-password', pilotOwner);
        assert.equal((await q(`SELECT count(*)::int AS n FROM "Message" WHERE metadata #>> '{deletion,deletedAt}' IS NOT NULL`)).rows[0].n, 1);
        for (const message of beforeMessages) assert.deepEqual((await q('SELECT * FROM "Message" WHERE id=$1', [message.id])).rows[0], message);
      });
      await t.test('later changes block rollback of the original client-creation run atomically', async () => {
        await assert.rejects(pilot.rollback(firstJob.jobId, firstRun.runId, 'synthetic-password', pilotOwner), /изменилось|зависимост/);
        assert.equal((await q('SELECT "archivedAt" FROM "Client" WHERE id=$1', [newClientId])).rows[0].archivedAt, null);
        assert.equal((await q('SELECT "amountMinor" FROM "Payment"')).rows[0].amountMinor, 19500);
      });
    } finally { await f.close(); }
  });

test('stale mapping approval, source precision and unverified media cannot write isolated history',
  { skip: process.env.YO_HISTORY_PGLITE !== '1', timeout: 120000 }, async () => {
    const { IsolatedHistoryMigrationPilot } = loadTargetModule('history-migration/isolated-history-pilot.ts');
    const f = await historyFixture(), pilot = new IsolatedHistoryMigrationPilot(f.repository, f.backups);
    try {
      const job = await f.stage([pilotMessage()]);
      await f.planning.bind(job.jobId, { mode: 'EXISTING', dialogueId: 'thread-a', clientId: 'existing' }, 'synthetic-password', pilotOwner);
      const old = await f.planning.dryRun(job.jobId, pilotOwner);
      await f.planning.bind(job.jobId, { mode: 'EXISTING', dialogueId: 'thread-a', clientId: 'existing' }, 'synthetic-password', pilotOwner);
      await assert.rejects(pilot.apply(job.jobId, old.previewDigest, 'synthetic-password', pilotOwner), /Предпросмотр изменился/);
      for (const change of [{ timestamp: null }, { sourceTimezone: 'Europe/Kyiv', sourceTimeText: '2024-10-27 03:30' },
        { attachments: [{ checksum: 'a'.repeat(64), name: 'synthetic.jpg', mimeType: 'image/jpeg', size: 10, available: true }] }]) {
        const uncertain = await f.stage([pilotMessage('uncertain', change)]);
        await f.planning.bind(uncertain.jobId, { mode: 'EXISTING', dialogueId: 'thread-a', clientId: 'existing' }, 'synthetic-password', pilotOwner);
        const preview = await f.planning.dryRun(uncertain.jobId, pilotOwner);
        await assert.rejects(pilot.apply(uncertain.jobId, preview.previewDigest, 'synthetic-password', pilotOwner), /замечания/);
      }
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "Message"')).rows[0].n, 0);
      assert.equal((await f.db.query('SELECT count(*)::int AS n FROM "HistoryMigrationPilotRun"')).rows[0].n, 0);
    } finally { await f.close(); }
  });
