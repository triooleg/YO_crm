import { createHash } from 'node:crypto';
import type { OutboxPacket } from './checkpoint.ts';

const MAX_MESSAGES = 100;
const MAX_TOTAL_MESSAGES = 1000;
const MAX_WIRE_BYTES = 512 * 1024;
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const invalid = (): never => { throw new Error('Invalid migration split input or no admissible partition'); };
const checksum = (json: string): string => createHash('sha256').update(json).digest('hex');

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Outbox data must already be lossless JSON. Reject accessors/toJSON, sparse
// arrays, nonfinite numbers and cycles rather than silently losing raw fields.
function assertJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)) return;
  if (typeof value !== 'object' || ancestors.has(value)) return invalid();
  const array = Array.isArray(value);
  if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return invalid();
  if (Object.getOwnPropertySymbols(value).length) return invalid();
  const entries = Object.entries(Object.getOwnPropertyDescriptors(value));
  if (array && entries.length !== value.length + 1) return invalid();
  ancestors.add(value);
  for (const [key, descriptor] of entries) {
    if (array && key === 'length') continue;
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') ||
        (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) return invalid();
    assertJson(descriptor.value, ancestors);
  }
  ancestors.delete(value);
}

// Same double-serialized envelope as C1; count UTF-8 bytes, not JS characters.
function fits(packet: OutboxPacket): boolean {
  return Buffer.byteLength(JSON.stringify({ batchId: packet.batchId, checksum: packet.checksum,
    payloadJson: JSON.stringify(packet.payload) })) <= MAX_WIRE_BYTES;
}

function replacementId(original: OutboxPacket, index: number, pieceChecksum: string): string {
  const bytes = createHash('sha256').update(JSON.stringify([
    'YO migrator packet split v1', original.batchId, original.checksum, index, pieceChecksum,
  ])).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type PacketSplitPlan = {
  originalBatchId: string;
  originalChecksum: string;
  replacements: OutboxPacket[];
};

/** Pure planning only: caller MUST durably persist the complete plan before
 * sending replacements. Never removes/ACKs the original or writes a checkpoint.
 * All returned packets are independent snapshots; no clocks or random IDs.
 * Greedily accepts the longest fitting piece with a checksum not used in this
 * plan (C1 unique(job, checksum)). If no next piece is admissible, rejects the
 * entire plan; no partial result escapes and no duplicate records are removed.
 */
export function planPacketSplit(original: OutboxPacket): PacketSplitPlan {
  try {
    assertJson(original);
    if (!record(original) || typeof original.batchId !== 'string' || !UUID4.test(original.batchId) ||
        original.pending !== true || typeof original.checksum !== 'string' ||
        !/^[a-f0-9]{64}$/.test(original.checksum)) return invalid();
    const payloadJson = JSON.stringify(original.payload);
    if (payloadJson === undefined || checksum(payloadJson) !== original.checksum) return invalid();
    const payload: unknown = JSON.parse(payloadJson);
    if (!record(payload) || payload.version !== 1 || payload.source !== 'KEYCRM' ||
        !record(payload.completeness) || !Array.isArray(payload.messages) ||
        payload.messages.length < 1 || payload.messages.length > MAX_TOTAL_MESSAGES ||
        !payload.messages.every(record)) return invalid();
    const messages: unknown[] = payload.messages;
    const replacements: OutboxPacket[] = [];
    if (messages.length <= MAX_MESSAGES && fits(original)) {
      replacements.push(structuredClone(original));
    } else {
      const usedChecksums = new Set<string>();
      let start = 0;
      while (start < messages.length) {
        let accepted: OutboxPacket | undefined;
        let acceptedEnd = start;
        let end = start;
        while (end < messages.length && end - start < MAX_MESSAGES) {
          const piecePayload = { ...payload, messages: messages.slice(start, end + 1) };
          const pieceChecksum = checksum(JSON.stringify(piecePayload));
          const candidate = { batchId: replacementId(original, replacements.length, pieceChecksum),
            checksum: pieceChecksum, payload: piecePayload, pending: true };
          if (!fits(candidate)) break;
          end++;
          if (!usedChecksums.has(pieceChecksum)) {
            accepted = candidate;
            acceptedEnd = end;
          }
        }
        if (!accepted) return invalid();
        // Independent metadata as well as messages, including across pieces.
        replacements.push(structuredClone(accepted));
        usedChecksums.add(accepted.checksum);
        start = acceptedEnd;
      }
    }
    return { originalBatchId: original.batchId, originalChecksum: original.checksum, replacements };
  } catch { return invalid(); }
}
