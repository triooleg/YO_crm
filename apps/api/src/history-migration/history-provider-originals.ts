import { ConflictException } from '@nestjs/common';
import { parseBackupJson } from '../backups/backup.json';
import { decryptSecret } from '../secret-box';

export type OriginalInstagramObservation = {messageId: string; provider: 'META_GRAPH_INSTAGRAM'; receiverId: string;
  customerId: string; observedAt: string; body: Record<string, unknown>};
const MAX_LEGACY_MESSAGES = 20, MAX_BODY_BYTES = 65536, TOTAL_MS = 8000;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/[\u0000-\u001f\u007f]/u.test(value);

/** Read-only evidence for legacy rows whose normalized envelope lost the original
 * source timestamp. Uses the existing connected server secret and fixed Meta host;
 * never browser cookies, caller URLs, provider sends or a receipt-time fallback.
 * Bounded pilot only; exceeding the legacy limit remains explicit review.
 */
export async function readOriginalInstagramMessages(messages: readonly {id: string; externalId: string | null}[],
  receiverId: string, customerId: string, encryptedToken: unknown, transport: typeof fetch = fetch): Promise<OriginalInstagramObservation[]> {
  const refuse = () => new ConflictException('Не удалось подтвердить исходные даты Instagram');
  try {
    if (!Array.isArray(messages) || messages.length > MAX_LEGACY_MESSAGES || !identifier(receiverId) || !identifier(customerId) ||
      messages.some(message => !identifier(message.id) || !identifier(message.externalId)) || new Set(messages.map(message => message.id)).size !== messages.length ||
      new Set(messages.map(message => message.externalId)).size !== messages.length) throw refuse();
    if (!messages.length) return [];
    if (typeof encryptedToken !== 'string' || !encryptedToken) throw refuse();
    const token = decryptSecret(encryptedToken), version = process.env.META_GRAPH_VERSION || 'v23.0';
    if (!token || !/^v[0-9]+\.[0-9]+$/.test(version)) throw refuse();
    const started = Date.now(), output: OriginalInstagramObservation[] = [];
    for (const message of messages) {
      const remaining = TOTAL_MS - (Date.now() - started);
      if (remaining <= 0) throw refuse();
      const url = new URL(`https://graph.instagram.com/${version}/${encodeURIComponent(message.externalId!)}`);
      url.searchParams.set('fields', 'id,created_time,from,to,message');
      const response = await transport(url, {method: 'GET', redirect: 'error', headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(Math.min(5000, remaining))});
      if (!response.ok || response.redirected || !response.body) throw refuse();
      const reader = response.body.getReader(), chunks: Buffer[] = []; let size = 0;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          size += part.value.byteLength;
          if (size > MAX_BODY_BYTES || Date.now() - started >= TOTAL_MS) throw refuse();
          chunks.push(Buffer.from(part.value));
        }
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
      const body = parseBackupJson(Buffer.concat(chunks));
      if (!body || typeof body !== 'object' || Array.isArray(body) || 'error' in body) throw refuse();
      output.push({messageId: message.id, provider: 'META_GRAPH_INSTAGRAM', receiverId, customerId,
        observedAt: new Date().toISOString(), body: body as Record<string, unknown>});
    }
    return output;
  } catch { throw refuse(); }
}
