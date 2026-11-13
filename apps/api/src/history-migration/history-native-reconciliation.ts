import { createHash } from 'node:crypto';

/** Caller retains the existing native-MID duplicate path before this guard.
 * Call inside the SAME ingestion transaction, after existing merge locks and
 * before any new timeline/unread/AI writes. PASS keeps the shared lock until
 * commit, so an exclusive importer cannot publish a window behind this read.
 */
export interface HistoryNativeEvent {
  /** Server-derived verified conversation and participants, never name/text
   * matching or archive-source IDs. accountId is the native integration account
   * for BOTH directions (map echo sender/customer recipient accordingly).
   */
  conversationId: string;
  channel: string;
  accountId: string;
  customerId: string;
  provider: string;
  nativeMessageId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  /** Original provider time normalized to UTC ISO milliseconds, or null.
   * Never substitute envelope receipt time, Date.now(), or a guessed timezone.
   */
  originalTimestamp: string | null;
  rawPayload: unknown;
  envelope: unknown;
}

/** Decoded ONLY by the transaction adapter using history-evidence. A rollback
 * retains this window; status never grants permission to replay old native rows.
 * Times are canonical UTC ISO strings; cutoff is EXCLUSIVE: next minute 00.000.
 */
export interface HistoryNativeWindow {
  version: 1;
  conversationId: string;
  channel: string;
  accountId: string;
  customerId: string;
  runId: string;
  status: 'APPLIED' | 'ROLLED_BACK';
  archiveStartAt: string;
  cutoffAt: string;
}

export type HistoryNativeBinding = {kind: 'NONE'} | {
  kind: 'PROTECTED'; conversationId: string; channel: string; accountId: string;
  customerId: string; runId: string; status: 'APPLIED' | 'ROLLED_BACK';
};

export type HistoryNativeDecision =
  | {action: 'PASS'; reason: 'NO_BINDING' | 'AT_OR_AFTER_CUTOFF'}
  | {action: 'REVIEW'; reason: 'INVALID_BINDING' | 'MISSING_WINDOW' | 'INVALID_WINDOW' | 'INVALID_EVENT' | 'SCOPE_MISMATCH' | 'UNKNOWN_ORIGINAL_TIME' | 'BEFORE_CUTOFF'};

export interface HistoryNativeReview {
  version: 1;
  reviewKey: string;
  scopeKey: string;
  payloadHash: string;
  conversationId: string;
  runId: string | null;
  reason: Extract<HistoryNativeDecision, {action: 'REVIEW'}>['reason'];
  /** Complete JSON snapshots, not excerpts or reconstructed Message fields.
   * Encrypt evidence at rest in the adapter; do not put these bodies in logs.
   * rawPayload/envelope can contain exact transport bytes represented as strings.
   */
  eventJson: string;
  bindingJson: string;
  windowJson: string;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const identifier = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
const scopeKeys = ['conversationId', 'channel', 'accountId', 'customerId'] as const;
function utcMillis(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return null;
  const millis = Date.parse(value);
  return Number.isFinite(millis) && new Date(millis).toISOString() === value ? millis : null;
}
function validWindow(value: unknown): value is HistoryNativeWindow {
  const window = record(value);
  if (!window || window.version !== 1 || !identifier(window.runId) || !scopeKeys.every(key => identifier(window[key])) ||
    (window.status !== 'APPLIED' && window.status !== 'ROLLED_BACK')) return false;
  const start = utcMillis(window.archiveStartAt), cutoff = utcMillis(window.cutoffAt);
  return start !== null && cutoff !== null && start < cutoff && (window.cutoffAt as string).endsWith(':00.000Z');
}

function protectedBinding(value: unknown): value is Extract<HistoryNativeBinding, {kind: 'PROTECTED'}> {
  const binding = record(value);
  return !!binding && binding.kind === 'PROTECTED' && identifier(binding.runId) && scopeKeys.every(key => identifier(binding[key])) &&
    (binding.status === 'APPLIED' || binding.status === 'ROLLED_BACK');
}

export interface HistoryNativeStorage {
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  /** Mandatory independent OPERATIONAL run lookup (nativeConversationId), NOT AppSetting
   * existence. Include rolled-back runs; ambiguity/corruption must throw or be
   * returned invalid, NEVER NONE. Do not gate this lookup on writer flags, and
   * do not select one of multiple conflicting runs without resolving coverage.
   */
  loadBinding(conversationId: string): Promise<HistoryNativeBinding>;
  /** Transaction-bound adapter authenticates sealed AppSetting evidence with
   * its purpose AND conversation key. null means absent, never decrypt failure.
   */
  loadWindow(binding: Extract<HistoryNativeBinding, {kind: 'PROTECTED'}>): Promise<unknown | null>;
  /** Atomic transaction-only INSERT of review + full envelope. Unique reviewKey
   * (scoped native MID + payload hash); exact retry returns existing id WITHOUT
   * updating evidence/timestamps. Different hashes insert separate rows. Failure
   * must throw, never acknowledge/drop an event. No Message/alias/unread/AI/send.
   */
  insertReviewAndEnvelope(review: HistoryNativeReview): Promise<{id: string; created: boolean}>;
}

/** Canonical JSON rejects values JSON.stringify would silently lose or coerce.
 * Sorting object keys makes parsed-equivalent deliveries idempotent; raw body
 * strings retain byte-level differences. Refusal aborts ingestion, never PASS.
 */
function evidenceJson(value: unknown, ancestors = new Set<object>(), depth = 0): string {
  if (depth > 128) throw new Error('HISTORY_NATIVE_EVIDENCE_NOT_JSON');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || value === null || ancestors.has(value)) throw new Error('HISTORY_NATIVE_EVIDENCE_NOT_JSON');
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) throw new Error('HISTORY_NATIVE_EVIDENCE_NOT_JSON');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.getOwnPropertySymbols(value).length || Object.entries(descriptors).some(([key, d]) =>
    !(Array.isArray(value) && key === 'length') && (!d.enumerable || !('value' in d)))) throw new Error('HISTORY_NATIVE_EVIDENCE_NOT_JSON');
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.keys(descriptors).length !== value.length + 1 || Array.from({length: value.length}, (_, i) => String(i)).some(key => !descriptors[key])) throw new Error('HISTORY_NATIVE_EVIDENCE_NOT_JSON');
      return '[' + value.map(item => evidenceJson(item, ancestors, depth + 1)).join(',') + ']';
    }
    return '{' + Object.keys(descriptors).sort().map(key => JSON.stringify(key) + ':' + evidenceJson(descriptors[key]!.value, ancestors, depth + 1)).join(',') + '}';
  } finally { ancestors.delete(value); }
}
const sha256 = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

export type HistoryNativeGuardResult = Extract<HistoryNativeDecision, {action: 'PASS'}> |
  (Extract<HistoryNativeDecision, {action: 'REVIEW'}> & {reviewId: string; created: boolean});

export function classifyHistoryNativeEvent(event: HistoryNativeEvent, binding: unknown, window: unknown): HistoryNativeDecision {
  if (record(binding)?.kind === 'NONE' && Object.keys(binding as object).length === 1) return {action: 'PASS', reason: 'NO_BINDING'};
  if (!protectedBinding(binding)) return {action: 'REVIEW', reason: 'INVALID_BINDING'};
  if (window === null) return {action: 'REVIEW', reason: 'MISSING_WINDOW'};
  if (!validWindow(window)) return {action: 'REVIEW', reason: 'INVALID_WINDOW'};
  if (!scopeKeys.every(key => identifier(event[key])) || !identifier(event.provider) || !identifier(event.nativeMessageId) ||
    (event.direction !== 'INBOUND' && event.direction !== 'OUTBOUND')) return {action: 'REVIEW', reason: 'INVALID_EVENT'};
  if (window.runId !== binding.runId || scopeKeys.some(key => event[key] !== window[key] || event[key] !== binding[key])) return {action: 'REVIEW', reason: 'SCOPE_MISMATCH'};
  const original = utcMillis(event.originalTimestamp);
  if (original === null) return {action: 'REVIEW', reason: 'UNKNOWN_ORIGINAL_TIME'};
  return original >= utcMillis(window.cutoffAt)! ? {action: 'PASS', reason: 'AT_OR_AFTER_CUTOFF'} : {action: 'REVIEW', reason: 'BEFORE_CUTOFF'};
}

export async function guardHistoryNativeEvent(storage: HistoryNativeStorage, event: HistoryNativeEvent): Promise<HistoryNativeGuardResult> {
  // Capture routing/time scalars before yielding to a lock; do not let caller
  // reuse of its event object change the conversation whose lock we hold.
  event = {...event};
  if (!identifier(event.conversationId)) throw new Error('HISTORY_NATIVE_CONVERSATION_REQUIRED');
  await storage.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtextextended(${'history-conversation:' + event.conversationId},0))`;
  const binding = await storage.loadBinding(event.conversationId);
  const window = protectedBinding(binding) ? await storage.loadWindow(binding) : null;
  const decision = classifyHistoryNativeEvent(event, binding, window);
  if (decision.action === 'PASS') return decision;
  const eventJson = evidenceJson(event), payloadHash = sha256(eventJson);
  const scopeKey = evidenceJson([event.conversationId, event.channel, event.accountId, event.customerId, event.provider, event.direction, event.nativeMessageId]);
  const saved = await storage.insertReviewAndEnvelope({version: 1, reviewKey: sha256(evidenceJson([scopeKey, payloadHash])), scopeKey, payloadHash,
    conversationId: event.conversationId, runId: protectedBinding(binding) ? binding.runId : null, reason: decision.reason,
    eventJson, bindingJson: evidenceJson(binding), windowJson: evidenceJson(window)});
  if (!saved || !identifier(saved.id) || typeof saved.created !== 'boolean') throw new Error('HISTORY_NATIVE_REVIEW_NOT_PERSISTED');
  return {...decision, reviewId: saved.id, created: saved.created};
}
