type SourceObject = Record<string, unknown>;
type InboundIdentity = {
  channel: string;
  externalMessageId: string;
  externalSenderId: string;
  receiverId?: string;
  accountId?: string;
};
const object = (value: unknown): SourceObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as SourceObject : {};
const records = (value: unknown): SourceObject[] => Array.isArray(value) ? value.map(object) : [];

function epoch(value: unknown, seconds: boolean): Date | null {
  const number = typeof value === 'number' ? value : typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value) ? Number(value) : NaN;
  const millis = number * (seconds ? 1000 : 1);
  if (!Number.isSafeInteger(millis) || millis <= 0) return null;
  const date = new Date(millis);
  return Number.isFinite(date.getTime()) ? date : null;
}

function sourceDate(value: unknown): Date | null {
  if (Object.prototype.toString.call(value) === '[object Date]') {
    const millis = (value as Date).getTime();
    return Number.isFinite(millis) && millis > 0 ? new Date(millis) : null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value)) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date : null;
}

/** Kept separate from the existing email persistence fallback to arrival time. */
export function trustedEmailTimestamp(parsedDate: unknown, internalDate: unknown): string | null {
  return (sourceDate(parsedDate) ?? sourceDate(internalDate))?.toISOString() ?? null;
}

/** Only source time from the exact provider event may establish push freshness. */
export function trustedInboundTimestamp(provider: 'META' | 'CHATWOOT' | 'EMAIL', payload: unknown, identity: InboundIdentity): Date | null {
  const raw = object(payload);
  if (provider === 'EMAIL') return sourceDate(raw.pushSourceTimestamp);
  if (provider === 'CHATWOOT') {
    const account = String(object(raw.account).id || object(raw.conversation).account_id || '0');
    if (raw.event !== 'message_created' || identity.externalMessageId !== 'chatwoot:' + account + ':' + String(raw.id || '') ||
        (identity.accountId && identity.accountId !== account)) return null;
    return epoch(raw.created_at, true) ?? sourceDate(raw.created_at);
  }
  const matches: Array<Date | null> = [];
  for (const entry of records(raw.entry)) {
    if (identity.channel === 'WHATSAPP') {
      for (const change of records(entry.changes)) {
        const value = object(change.value);
        if (String(object(value.metadata).phone_number_id || '') !== identity.receiverId) continue;
        for (const message of records(value.messages)) {
          if (String(message.id || '') === identity.externalMessageId && String(message.from || '') === identity.externalSenderId) matches.push(epoch(message.timestamp, true));
        }
      }
      continue;
    }
    if (String(entry.id || '') !== identity.receiverId) continue;
    for (const event of [...records(entry.messaging), ...records(entry.standby)]) {
      const message = object(event.message);
      if (String(message.mid || '') === identity.externalMessageId && message.is_echo !== true &&
          String(object(event.sender).id || '') === identity.externalSenderId &&
          String(object(event.recipient).id || '') === identity.receiverId) matches.push(epoch(event.timestamp, false));
    }
    for (const change of records(entry.changes)) {
      const value = object(change.value);
      const sender = object(value.from);
      const username = String(sender.username || value.username || '');
      const senderId = String(sender.id || value.sender_id || (username ? 'instagram-username:' + username : ''));
      if (senderId !== identity.externalSenderId) continue;
      const field = String(change.field || '');
      const nativeId = identity.channel === 'FACEBOOK' ? String(value.comment_id || value.id || '') : String(value.id || value.comment_id || value.media_id || '');
      const action = String(value.verb || value.action || 'add').toLowerCase();
      const reactionId = ['engagement','reaction',senderId,String(value.comment_id || value.post_id || value.parent_id || ''),action,String(value.created_time || entry.time || '')].join(':');
      const matching = (field === 'feed' && (nativeId === identity.externalMessageId || (value.item === 'reaction' && reactionId === identity.externalMessageId))) ||
        (['comments','live_comments','mentions'].includes(field) && nativeId === identity.externalMessageId);
      // entry.time can describe a new batch containing an old source object.
      // Require the object's own time for push while persistence keeps its fallback.
      if (matching) matches.push(epoch(value.created_time, Number(value.created_time) < 10000000000) ?? sourceDate(value.created_time));
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}
