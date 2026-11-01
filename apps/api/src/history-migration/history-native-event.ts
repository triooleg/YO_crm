import { originalMetaTimestamp } from '../communications/meta-webhook';

type MetaHistoryScope = { accountId: string; customerId: string; nativeMessageId: string; direction: 'INBOUND' | 'OUTBOUND' };
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

/** Extract source time from the exact signed webhook event. Existing normalizers
 * may substitute arrival time for a missing timestamp; that fallback must never
 * establish that a protected historical event is new. Ambiguity stays reviewable.
 */
export function originalMetaHistoryTimestamp(payload: unknown, scope: MetaHistoryScope): string | null {
  const entries = object(payload).entry;
  if (!Array.isArray(entries) || !scope.accountId || !scope.customerId || !scope.nativeMessageId) return null;
  const matches: unknown[] = [];
  for (const value of entries) {
    const entry = object(value);
    if (entry.id !== scope.accountId) continue;
    for (const group of [entry.messaging, entry.standby]) {
      if (!Array.isArray(group)) continue;
      for (const raw of group) {
        const event = object(raw), message = object(event.message);
        const outbound = scope.direction === 'OUTBOUND';
        if (message.mid !== scope.nativeMessageId ||
          object(event.sender).id !== (outbound ? scope.accountId : scope.customerId) ||
          object(event.recipient).id !== (outbound ? scope.customerId : scope.accountId) ||
          (outbound ? message.is_echo !== true : message.is_echo === true)) continue;
        matches.push(event.timestamp);
      }
    }
  }
  if (matches.length !== 1) return null;
  return originalMetaTimestamp(matches[0]);
}
