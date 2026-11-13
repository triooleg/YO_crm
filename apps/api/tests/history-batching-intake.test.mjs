import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { loadTargetModule } from './overview-target-loader.mjs';
import { historyFixture, pilotMessage, pilotOwner, pilotScope } from './history-migration-fixture.mjs';

test('deterministic split packets satisfy actual C1 intake checksum uniqueness and replay',
  { skip: process.env.YO_HISTORY_PGLITE !== '1', timeout: 120000 }, async () => {
    const { planPacketSplit } = loadTargetModule('../../../tools/migrator-agent/src/batching.ts');
    const f = await historyFixture();
    try {
      const payload = { version: 1, source: 'KEYCRM', messages: Array.from({ length: 200 }, () => pilotMessage()), completeness: { status: 'PARTIAL' } };
      const original = { batchId: randomUUID(), checksum: createHash('sha256').update(JSON.stringify(payload)).digest('hex'), payload, pending: true };
      const plan = planPacketSplit(original);
      assert.deepEqual(plan.replacements.map(packet => packet.payload.messages.length), [100, 99, 1]);
      const job = await f.intake.create(pilotScope, 'synthetic-password', pilotOwner);
      const pair = await f.intake.pair(job.jobId, 'synthetic-password', pilotOwner);
      for (const packet of plan.replacements) {
        const body = { batchId: packet.batchId, checksum: packet.checksum, payloadJson: JSON.stringify(packet.payload) };
        const ack = await f.intake.stage(job.jobId, `Bearer ${pair.token}`, body);
        assert.equal(ack.status, 'STAGED'); assert.equal(ack.checksum, packet.checksum);
        assert.deepEqual(await f.intake.stage(job.jobId, `Bearer ${pair.token}`, body), ack);
      }
      const stored = await f.intake.preview(job.jobId, pilotOwner);
      assert.equal(stored.batchCount, 3); assert.equal(stored.messageCount, 200);
      assert.equal(stored.inBatchDuplicates, 199); assert.equal(stored.addedToCrm, 0);
      assert.equal(original.pending, true); assert.equal(original.payload.messages.length, 200);
    } finally { await f.close(); }
  });
