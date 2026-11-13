import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTargetModule } from './overview-target-loader.mjs';
const model = loadTargetModule('history-migration/history-planning-model.ts');
const message = (id = 'one', extra = {}) => ({ source: 'KEYCRM', account: 'synthetic-business', channel: 'INSTAGRAM', dialogueId: 'thread-a',
  sourceMessageId: id, direction: 'INBOUND', sender: 'person', timestamp: '2024-01-01T12:00:00Z', text: 'Synthetic history', ordinal: 0, attachments: [], ...extra });
const target = (dialogueId = 'thread-a', extra = {}) => ({ dialogueId, groupKey: 'client:one', clientId: 'one', state: 'MATCHED', ...extra });
const empty = () => ({ existing: [], blockers: [], fingerprint: 'empty', unverifiedCount: 0, hiddenIds: [], conflicts: [] });

test('mapped dry-run proposes exact-time text without mutating existing data and keeps original dialogues', () => {
  const history = empty(), before = structuredClone(history);
  const result = model.planMappedTimeline([message()], [target()], new Map([['client:one', history]]));
  assert.equal(result.newCandidates, 1); assert.equal(result.actions[0].clientId, 'one');
  assert.equal(result.actions[0].message.dialogueId, 'thread-a'); assert.deepEqual(history, before);
});

test('two source dialogues with same content/time require review rather than creating an unproven duplicate', () => {
  const rows = [message(), message('different-source-id', { dialogueId: 'thread-b' })];
  const result = model.planMappedTimeline(rows, [target(), target('thread-b')], new Map([['client:one', empty()]]));
  assert.equal(result.newCandidates, 0); assert.equal(result.review, 2);
  assert.equal(result.actions.length, 2); assert.equal(new Set(result.actions.map(a => a.message.dialogueId)).size, 2);
  const sameDialogue = model.planMappedTimeline([message(), message('same-text-real-repeat')], [target()], new Map([['client:one', empty()]]));
  assert.equal(sameDialogue.newCandidates, 2);
});

test('minute precision, missing mapping and unverified files cannot become ready writes', () => {
  for (const change of [{ timestamp: null }, { sourceTimezone: 'Europe/Kyiv', sourceTimeText: '2024-10-27 03:30' },
    { attachments: [{ checksum: 'a'.repeat(64), name: 'synthetic.jpg', mimeType: 'image/jpeg', size: 10, available: true }] }]) {
    const result = model.planMappedTimeline([message('one', change)], [target()], new Map([['client:one', empty()]]));
    assert.equal(result.newCandidates, 0); assert.equal(result.review, 1);
  }
  const result = model.planMappedTimeline([message()], [], new Map());
  assert.equal(result.unmapped, 1); assert.ok(result.blockers.includes('CLIENT_MAPPING_REQUIRED'));
});
