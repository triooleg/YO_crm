import { createHash } from 'node:crypto';
import { parseBackupJson } from '../backups/backup.json';
import { normalizeMessage, type Channel, type Source } from './history';

export const MAX_PACKET_BYTES = 512 * 1024;
export const MAX_PACKET_MESSAGES = 100;
export const MAX_JOB_BATCHES = 100;
export const MAX_JOB_BYTES = 32 * 1024 * 1024;
export type HistoryScope = { source: Source; account: string; channel: Channel };
export type IntakePacket = { batchId: string; checksum: string; payloadJson: string };
export const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
export function migrationId(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Некорректный идентификатор задания или пакета');
}
export function validateHistoryScope(value: unknown): HistoryScope {
  const r = object(value);
  // The first migration stage is KeyCRM. Other source adapters require a separate pilot.
  if (r.source !== 'KEYCRM' || !['EMAIL', 'INSTAGRAM', 'FACEBOOK', 'WHATSAPP'].includes(String(r.channel)) ||
    typeof r.account !== 'string' || !r.account.trim() || r.account !== r.account.trim() || r.account.length > 160 || /[\x00-\x1f\x7f]/.test(r.account)) throw new Error('Некорректная область источника');
  return { source: r.source, account: r.account, channel: r.channel as Channel };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидался объект');
  return value as Record<string, unknown>;
}
export function validateIntakePacket(value: unknown, scope: HistoryScope) {
  const packet = object(value);
  if (Object.keys(packet).sort().join(',') !== 'batchId,checksum,payloadJson') throw new Error('Некорректные поля пакета');
  migrationId(packet.batchId);
  if (typeof packet.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(packet.checksum) || typeof packet.payloadJson !== 'string') throw new Error('Некорректная контрольная сумма');
  const payloadBytes = Buffer.byteLength(packet.payloadJson, 'utf8');
  if (payloadBytes < 1 || payloadBytes > MAX_PACKET_BYTES || sha256(packet.payloadJson) !== packet.checksum) throw new Error('Размер или контрольная сумма пакета не совпадает');
  const payload = object(parseBackupJson(Buffer.from(packet.payloadJson, 'utf8')));
  if (Object.keys(payload).some(key => !['version', 'source', 'messages', 'completeness'].includes(key)) || payload.version !== 1 || payload.source !== scope.source ||
    !Array.isArray(payload.messages) || payload.messages.length < 1 || payload.messages.length > MAX_PACKET_MESSAGES) throw new Error('Некорректное содержимое пакета');
  const completeness = object(payload.completeness);
  if (!['PARTIAL', 'CONFIRMED_START', 'UNAVAILABLE', 'COMPLETE'].includes(String(completeness.status))) throw new Error('Укажите состояние полноты источника');
  const normalized = payload.messages.map(value => {
    const message = normalizeMessage(value);
    if (message.source !== scope.source || message.account !== scope.account || message.channel !== scope.channel) throw new Error('Сообщение находится вне области задания');
    return message;
  });
  // A collector assertion is inventory, never proof of full extraction or native identity.
  return { batchId: packet.batchId, checksum: packet.checksum, payloadJson: packet.payloadJson,
    payloadBytes, messageCount: normalized.length, normalized, rawMessages: payload.messages,
    sourceCompleteness: 'UNVERIFIED' as const };
}
