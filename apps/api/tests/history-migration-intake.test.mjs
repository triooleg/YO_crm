import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { loadTargetModule } from './overview-target-loader.mjs';
const rules = loadTargetModule('history-migration/intake-rules.ts');
const scope = { source: 'KEYCRM', account: 'synthetic-business', channel: 'INSTAGRAM' };
const message = (id = 'm1', extra = {}) => ({ ...scope, dialogueId: 'dialogue-a', sourceMessageId: id,
  sender: 'synthetic-person', direction: 'INBOUND', timestamp: '2024-02-29T10:15:00+02:00',
  text: 'Synthetic history', attachments: [], ordinal: 0, ...extra });
const packet = (messages = [message()]) => {
  const payloadJson = JSON.stringify({ version: 1, source: 'KEYCRM', messages, completeness: { status: 'PARTIAL' } });
  return { batchId: randomUUID(), checksum: createHash('sha256').update(payloadJson).digest('hex'), payloadJson };
};

test('intake validates exact bytes, source scope and counts without trusting completeness or native evidence', () => {
  const p = packet(); const result = rules.validateIntakePacket(p, scope);
  assert.equal(result.messageCount, 1); assert.equal(result.payloadBytes, Buffer.byteLength(p.payloadJson));
  assert.equal(result.checksum, p.checksum); assert.equal(result.sourceCompleteness, 'UNVERIFIED');
  assert.equal(result.normalized[0].time.utc, '2024-02-29T08:15:00.000Z');
  assert.throws(() => rules.validateIntakePacket({ ...p, payloadJson: p.payloadJson + ' ' }, scope));
  for (const change of [{ account: 'other' }, { source: 'INSTAGRAM' }, { channel: 'FACEBOOK' }])
    assert.throws(() => rules.validateIntakePacket(packet([message('m1', change)]), scope));
});

test('malformed, unbounded and ambiguous JSON is rejected before staging', () => {
  const base = packet();
  const checked = payloadJson => ({ ...base, payloadJson, checksum: createHash('sha256').update(payloadJson).digest('hex') });
  assert.throws(() => rules.validateIntakePacket(checked('{"version":1,"version":1}'), scope));
  assert.throws(() => rules.validateIntakePacket(packet([]), scope));
  assert.throws(() => rules.validateIntakePacket(packet(Array.from({ length: 101 }, (_, i) => message(String(i)))), scope));
  assert.throws(() => rules.validateIntakePacket(packet([message('m1', { timestamp: '2023-02-29T00:00:00Z' })]), scope));
  assert.throws(() => rules.validateIntakePacket({ ...base, token: 'never accepted' }, scope));
  assert.throws(() => rules.validateIntakePacket(checked(' '.repeat(524289)), scope));
});

test('minute labels retain uncertainty, and sender/native proof are not elevated into server authority', () => {
  const p = packet([message('m1', { timestamp: null, sourceTimezone: 'Europe/Kyiv', sourceTimeText: '2024-10-27 03:30',
    nativeIdentity: { provider: 'INSTAGRAM', channel: 'INSTAGRAM', account: 'native-account', dialogueId: 'native-thread', messageId: 'native-message', proofId: 'self-asserted' } })]);
  const parsed = rules.validateIntakePacket(p, scope);
  assert.equal(parsed.normalized[0].time.precision, 'MINUTE'); assert.equal(parsed.normalized[0].time.utc, null);
  assert.equal(parsed.sourceCompleteness, 'UNVERIFIED');
});
