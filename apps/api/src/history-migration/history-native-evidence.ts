import { createHash } from 'node:crypto';
import { normalizeMessage, keycrmArchiveEligible, originalTime } from './history';

type Time = Date | string;
type Conversation = { id: string; clientId: string; channel: string; externalId: string | null; archivedAt: Time | null };
type Message = { id: string; conversationId: string; direction: string; status: string; content: string;
  normalizedText: string | null; messageType: string; externalId: string | null; metadata: unknown; rawPayload: unknown;
  webhookEnvelopeId: string | null; receivedAt: Time | null; sentAt: Time | null; createdAt: Time; authorId: string | null };
type Envelope = { id: string; provider: string; payload: unknown; payloadHash: string; receivedAt: Time };
type DeliveryAttempt = { id: string; clientRequestId: string; clientId: string; conversationId: string;
  messageId: string | null; status: string; createdAt: Time; updatedAt: Time };
type Attachment = { messageId: string; type: string; externalUrl: string | null; metadata: unknown };

/** Server-fetched official message detail, never a request DTO or verified flag.
 * Full documents stay private; only validated semantic fields enter plan identity. */
export type NativeProviderObservation = {
  messageId: string;
  provider: 'META_GRAPH_INSTAGRAM';
  receiverId: string;
  customerId: string;
  observedAt: string;
  // Untrusted parsed Graph JSON: shape and every authority-bearing field are
  // validated here, rather than asserted by the network reader's TypeScript type.
  body: Record<string, unknown>;
};
export const MAX_NATIVE_PROVIDER_OBSERVATION_AGE_MS = 5 * 60 * 1000;

/** Internal server snapshot, read under the coordinator's transaction/locks.
 * Never accept this object, or a returned ID set, as trusted HTTP input.
 * `origins` only excludes rows from native qualification; the unchanged strict
 * projector must independently validate their sealed evidence. This function
 * neither creates KeyCRM origins/aliases nor authorizes a database operation. */
export type NativeHistorySnapshot = {
  client: { id: string; instagram: string | null; instagramUsername: string | null; archivedAt: Time | null };
  receiverId: string; archive: readonly unknown[]; conversations: readonly Conversation[]; messages: readonly Message[];
  envelopes: readonly Envelope[]; deliveryAttempts: readonly DeliveryAttempt[];
  origins: readonly { messageId: string }[]; attachments: readonly Attachment[];
  providerObservations?: readonly NativeProviderObservation[];
};
export type NativeHistoryQualification = {
  status: 'QUALIFIED' | 'REVIEW'; archiveEndExclusive: string | null; validatedMessageIds: string[];
  messageFingerprints: Record<string, string>; fingerprint: string | null; blockers: { messageId?: string; code: string }[];
};

const record = (value: unknown): Record<string, unknown> | null => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const numericId = (value: unknown): value is string => typeof value === 'string' && /^[1-9][0-9]{0,39}$/.test(value);
const opaqueId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9._:+/=-]{1,2048}$/.test(value) && !/^(?:keycrm|history|archive|yo_history|engagement|instagram-username)[:_-]/i.test(value);

/** Canonical semantic JSON: JSONB may reorder object keys. Array order and
 * multiplicity remain significant. Limits fail closed before hashing deep data. */
function canonical(value: unknown): string {
  let nodes = 0, bytes = 0;
  const visit = (part: unknown, depth: number): unknown => {
    bytes += typeof part === 'string' ? Buffer.byteLength(part) : 8;
    if (++nodes > 500000 || depth > 64 || bytes > 33554432) throw Error('SNAPSHOT_LIMIT');
    if (part instanceof Date) return part.toISOString();
    if (part === null || typeof part === 'string' || typeof part === 'boolean') return part;
    if (typeof part === 'number' && Number.isFinite(part)) return part;
    if (Array.isArray(part)) return part.map(item => visit(item, depth + 1));
    const object = record(part);
    if (!object) throw Error('SNAPSHOT_JSON_INVALID');
    return Object.fromEntries(Object.keys(object).sort().map(key => { bytes += Buffer.byteLength(key); return [key, visit(object[key], depth + 1)]; }));
  };
  const text = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(text) > 33554432) throw Error('SNAPSHOT_LIMIT');
  return text;
}
const digest = (value: unknown) => createHash('sha256').update(canonical(value)).digest('hex');
/** Binding only, never a provenance credential. Use exactly history.messages rows. */
export const nativeMessageFingerprint = (message: unknown): string => digest(message);
function noMedia(metadata: Record<string,unknown>): boolean {
  return ['attachments','attachmentTypes'].every(key => metadata[key] === undefined || Array.isArray(metadata[key]) && metadata[key].length === 0) && metadata.engagement === undefined;
}
function eventMetadataMatches(event: Record<string,unknown>, stored: Record<string,unknown>): boolean {
  return Object.entries(event).every(([key,value]) => Object.hasOwn(stored,key) && digest(value) === digest(stored[key]));
}
function instant(value: unknown): number | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  try { const time = originalTime(value); return time.utc ? new Date(time.utc).getTime() : null; }
  catch { return null; }
}

function canonicalUtc(value: unknown): number | null {
  const parsed = instant(value);
  return typeof value === 'string' && parsed !== null && value === new Date(parsed).toISOString() ? parsed : null;
}
function providerObservation(value: unknown, now: number) {
  const observation = record(value), body = record(observation?.body), from = record(body?.from), to = record(body?.to);
  const recipient = Array.isArray(to?.data) && to.data.length === 1 ? record(to.data[0]) : null;
  const observed = canonicalUtc(observation?.observedAt);
  // Meta Graph message detail returns UTC seconds with the basic +0000 offset.
  // originalTime validates calendar dates instead of accepting Date rollover.
  const original = typeof body?.created_time === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+0000$/.test(body.created_time)
    ? instant(body.created_time.slice(0,-5) + 'Z') : null;
  if (!observation || observation.provider !== 'META_GRAPH_INSTAGRAM' ||
      typeof observation.messageId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(observation.messageId) ||
      !numericId(observation.receiverId) || !numericId(observation.customerId) || !opaqueId(body?.id) ||
      !numericId(from?.id) || !numericId(recipient?.id) || typeof body?.message !== 'string' ||
      original === null || observed === null || observed < original || observed > now || now-observed > MAX_NATIVE_PROVIDER_OBSERVATION_AGE_MS)
    throw Error('NATIVE_PROVIDER_OBSERVATION_INVALID');
  // Never hash observedAt or optional display/usernames: preview and apply fetch
  // fresh observations, whose equivalent provider facts must keep one digest.
  return { messageId: observation.messageId, provider: observation.provider, receiverId: observation.receiverId,
    customerId: observation.customerId, nativeMessageId: body.id, originalAt: new Date(original).toISOString(),
    fromId: from.id, toId: recipient.id, text: body.message };
}
type ProviderProof = ReturnType<typeof providerObservation>;
function observedOriginalTime(proof: ProviderProof | undefined, message: Message, receiver: string, customer: string, effective: number): number | null {
  if (!proof || proof.messageId !== message.id || proof.receiverId !== receiver || proof.customerId !== customer ||
      proof.nativeMessageId !== message.externalId || proof.text !== message.content ||
      proof.fromId !== (message.direction === 'OUTBOUND' ? receiver : customer) ||
      proof.toId !== (message.direction === 'OUTBOUND' ? customer : receiver)) return null;
  const original = new Date(proof.originalAt).getTime();
  return Math.floor(original/1000) === Math.floor(effective/1000) ? original : null;
}

/** Raw staged archive only, never a caller-supplied cutoff or verified flag. */
export function archiveCutoffExclusive(archive: readonly unknown[]): string {
  try {
    if (!Array.isArray(archive) || !archive.length || archive.length > 10000) throw Error('ARCHIVE_WINDOW');
    const messages = archive.map(normalizeMessage), first = messages[0]!;
    if (messages.some(message => !keycrmArchiveEligible(message) || message.account !== first.account)) throw Error('ARCHIVE_WINDOW');
    return new Date(Math.max(...messages.map(message => new Date(message.time.utc!).getTime())) + 60000).toISOString();
  } catch { throw Error('ARCHIVE_WINDOW_UNVERIFIED'); }
}

/** Validated IDs are direct INSTAGRAM evidence only. All-or-nothing: any native
 * ambiguity returns REVIEW with no usable ID set. The fingerprint is evidence
 * binding, not a capability token; recompute it in the guarded transaction. */
export function qualifyNativeHistoryBaseline(input: NativeHistorySnapshot): NativeHistoryQualification {
  const blockers: NativeHistoryQualification['blockers'] = [];
  let fingerprint: string | null = null, archiveEndExclusive: string | null = null;
  const ids: string[] = [], proofs = new Map<string,string>();
  const observations = new Map<string, ProviderProof>();
  const accept = (message: Message) => { ids.push(message.id); proofs.set(message.id,nativeMessageFingerprint(message)); };
  const fail = (code: string, messageId?: string) => { blockers.push({ ...(messageId ? { messageId } : {}), code }); };
  const result = (): NativeHistoryQualification => ({ status: blockers.length ? 'REVIEW' : 'QUALIFIED', archiveEndExclusive,
    validatedMessageIds: blockers.length ? [] : ids.sort(), messageFingerprints: blockers.length ? {} : Object.fromEntries([...proofs].sort(([a],[b])=>a<b?-1:a>b?1:0)), fingerprint,
    blockers: blockers.sort((a,b)=>(a.messageId??'').localeCompare(b.messageId??'')||a.code.localeCompare(b.code)) });
  try {
    for (const rows of [input.archive,input.conversations,input.messages,input.envelopes,input.deliveryAttempts,input.origins,input.attachments]) {
      if (!Array.isArray(rows) || rows.length > 10000) throw Error('SNAPSHOT_LIMIT');
      if (rows.some(row => !record(row))) throw Error('SNAPSHOT_RECORD_INVALID');
    }
    const supplied = input.providerObservations === undefined ? [] : input.providerObservations;
    if (!Array.isArray(supplied) || supplied.length > 20) throw Error('NATIVE_PROVIDER_OBSERVATION_INVALID');
    canonical({...input,providerObservations:supplied}); // Bound full private documents before projection.
    const now = Date.now();
    for (const raw of supplied) {
      const observation = providerObservation(raw, now);
      if (observations.has(observation.messageId) || !input.messages.some(message => message.id === observation.messageId) ||
          input.origins.some(origin => origin.messageId === observation.messageId)) throw Error('NATIVE_PROVIDER_OBSERVATION_INVALID');
      observations.set(observation.messageId, observation);
    }
    const sets = Object.fromEntries((['conversations','messages','envelopes','deliveryAttempts','origins','attachments'] as const).map(key => [key,
      input[key].map(row => ({ row, key: canonical(row) })).sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0).map(item => item.row)]));
    const {providerObservations: _volatileObservations, ...stableInput} = input;
    fingerprint = digest({ ...stableInput, ...sets,
      providerObservations:[...observations.values()].sort((a,b)=>a.messageId<b.messageId?-1:a.messageId>b.messageId?1:0) });
  } catch { fail('NATIVE_SNAPSHOT_INVALID'); return result(); }
  let cutoff: number;
  try {
    archiveEndExclusive = archiveCutoffExclusive(input.archive);
    cutoff = new Date(archiveEndExclusive).getTime();
  } catch { fail('ARCHIVE_WINDOW_UNVERIFIED'); return result(); }
  const client = input.client;
  if (!client || !client.id || client.archivedAt !== null || !numericId(client.instagram) || !numericId(input.receiverId) ||
      typeof client.instagramUsername !== 'string' || !/^@?[A-Za-z0-9._]{1,30}$/.test(client.instagramUsername)) {
    fail('NATIVE_CLIENT_SCOPE_INVALID'); return result();
  }
  const originIds = new Set(input.origins.map(origin => origin.messageId));
  const seen = new Set<string>();
  for (const message of input.messages) {
    if (typeof message.id !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(message.id) || seen.has(message.id)) { fail('NATIVE_MESSAGE_ID_INVALID'); continue; }
    seen.add(message.id);
    if (originIds.has(message.id)) continue;
    const metadata = record(message.metadata), conversations = input.conversations.filter(row => row.id === message.conversationId);
    const conversation = conversations[0];
    if (conversations.length !== 1 || !conversation || conversation.archivedAt !== null || conversation.clientId !== client.id ||
        conversation.channel !== 'INSTAGRAM' || conversation.externalId !== `${input.receiverId}:${client.instagram}` ||
        metadata?.receiverId !== input.receiverId || (metadata.provider !== undefined && metadata.provider !== 'META')) {
      fail('NATIVE_CONVERSATION_SCOPE_INVALID', message.id); continue;
    }
    if (!opaqueId(message.externalId) || metadata.historyArchive !== undefined || metadata.historyMigration !== undefined ||
        metadata.deletion !== undefined || metadata.deduplicatedIntoMessageId !== undefined || message.messageType !== 'text' ||
        !noMedia(metadata) || (metadata.messageType !== undefined && metadata.messageType !== message.messageType) ||
        typeof message.content !== 'string' || !message.content.trim() || message.content.length > 5000) {
      fail('NATIVE_MESSAGE_UNSUPPORTED', message.id); continue;
    }
    const effective = instant(message.direction === 'INBOUND' ? message.receivedAt : message.sentAt), created = instant(message.createdAt);
    if (effective === null || created === null) { fail('NATIVE_TIME_OVERLAP_OR_UNKNOWN', message.id); continue; }
    if (message.direction === 'OUTBOUND') {
      const attempts = input.deliveryAttempts.filter(row => row.messageId === message.id), attempt = attempts[0];
      const reserved = instant(attempt?.createdAt), completed = instant(attempt?.updatedAt);
      if (message.status !== 'SENT' || metadata.source !== 'CRM' || metadata.provider !== 'META' || metadata.recipientId !== client.instagram ||
          !message.authorId || message.receivedAt !== null || message.webhookEnvelopeId !== null || message.rawPayload !== null || created > effective ||
          (message.normalizedText !== null && message.normalizedText !== message.content.normalize('NFKC')) ||
          (metadata.metaEchoReceivedAt !== undefined && instant(metadata.metaEchoReceivedAt) !== effective) ||
          attempts.length !== 1 || !attempt || !opaqueId(attempt.id) || !opaqueId(attempt.clientRequestId) ||
          attempt.status !== 'SENT' || attempt.clientId !== client.id || attempt.conversationId !== message.conversationId ||
          reserved === null || completed === null || reserved > effective || completed < effective ||
          input.attachments.some(row => row.messageId === message.id)) {
        fail('NATIVE_DELIVERY_EVIDENCE_INVALID', message.id); continue;
      }
      const original = observedOriginalTime(observations.get(message.id), message, input.receiverId, client.instagram, effective);
      if (original === null) { fail('NATIVE_ORIGINAL_TIME_UNVERIFIED',message.id); continue; }
      if (original < cutoff) { fail('NATIVE_TIME_OVERLAP_OR_UNKNOWN',message.id); continue; }
      accept(message); continue;
    }
    if (message.direction !== 'INBOUND' || message.status !== 'RECEIVED' || metadata.source !== 'META' || message.sentAt !== null ||
        created !== effective || message.normalizedText !== message.content.normalize('NFKC')) {
      fail('NATIVE_MESSAGE_STATE_INVALID', message.id); continue;
    }
    const envelopes = input.envelopes.filter(row => row.id === message.webhookEnvelopeId), envelope = envelopes[0];
    const payload = record(envelope?.payload), eventMetadata = record(payload?.metadata);
    if (envelopes.length !== 1 || !envelope || envelope.provider !== 'META' || !/^[a-f0-9]{64}$/.test(envelope.payloadHash) ||
        instant(envelope.receivedAt) !== effective || digest(message.rawPayload) !== digest(envelope.payload) ||
        payload?.provider !== 'META' || payload.channel !== 'INSTAGRAM' || payload.receiverId !== input.receiverId ||
        payload.externalSenderId !== client.instagram || payload.externalMessageId !== message.externalId ||
        payload.content !== message.content || instant(payload.receivedAt) !== effective || eventMetadata?.messageType !== message.messageType ||
        !noMedia(eventMetadata) || !eventMetadataMatches(eventMetadata,metadata) ||
        input.attachments.some(row => row.messageId === message.id) || input.deliveryAttempts.some(row => row.messageId === message.id)) {
      fail('NATIVE_ENVELOPE_EVIDENCE_INVALID', message.id); continue;
    }
    const rawOriginal = payload.originalTimestamp, exactOriginal = canonicalUtc(rawOriginal);
    const observation = observations.get(message.id);
    const providerOriginal = observedOriginalTime(observation,message,input.receiverId,client.instagram,effective);
    if ((rawOriginal !== undefined && rawOriginal !== null && (exactOriginal === null || exactOriginal !== effective)) ||
        (observation && providerOriginal === null)) { fail('NATIVE_ORIGINAL_TIME_UNVERIFIED',message.id); continue; }
    const original = exactOriginal ?? providerOriginal;
    if (original === null) { fail('NATIVE_ORIGINAL_TIME_UNVERIFIED',message.id); continue; }
    if (original < cutoff) { fail('NATIVE_TIME_OVERLAP_OR_UNKNOWN',message.id); continue; }
    accept(message);
  }
  return result();
}
