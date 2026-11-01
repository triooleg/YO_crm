import { matchHistoricalClient, type Channel, type Source } from './history';
import { sha256 } from './intake-rules';

export type TargetClient = { id: string; displayName: string; email: string | null; phone: string | null; whatsapp: string | null;
  status: string; archivedAt: Date | null };
export type ClientRedirect = { sourceClientId: string; targetClientId: string };
export type MatchInput = { email?: string; phone?: string; confirmedClientId?: string };

function phone(value: string | null | undefined, requireInternational: boolean) {
  const normalized = value?.replace(/[\s().-]/g, '') ?? '';
  if (requireInternational && !/^\+[1-9]\d{7,14}$/.test(normalized)) return null;
  const digits = normalized.replace(/^\+/, '');
  return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : null;
}
export function canonicalTargetId(id: string, clients: readonly TargetClient[], redirects: readonly ClientRedirect[]): string | null {
  const seen = new Set<string>();
  for (let depth = 0; depth <= 20; depth++) {
    if (seen.has(id)) return null;
    seen.add(id);
    const next = redirects.find(row => row.sourceClientId === id);
    if (next) { id = next.targetClientId; continue; }
    const client = clients.find(row => row.id === id);
    return client && !client.archivedAt && client.status !== 'BLOCKED' ? id : null;
  }
  return null;
}
/** Name and order number never enter this resolver. Redirects retain source contacts. */
export function matchCanonicalTargets(input: MatchInput, clients: readonly TargetClient[], redirects: readonly ClientRedirect[]) {
  const email = input.email?.trim().toLowerCase();
  const validEmail = email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
  const validPhone = phone(input.phone, true) ?? undefined;
  if ((input.phone && !validPhone) || (input.email && !validEmail)) return { status: 'REVIEW' as const, clientId: null, candidates: [] as string[] };
  const candidates = new Map<string, { id: string; emails: string[]; phones: string[] }>();
  const invalidMatches = new Set<string>();
  for (const row of clients) {
    const matched = Boolean(validEmail && row.email?.trim().toLowerCase() === validEmail) ||
      Boolean(validPhone && [row.phone, row.whatsapp].some(p => phone(p, false) === validPhone)) || input.confirmedClientId === row.id;
    const id = canonicalTargetId(row.id, clients, redirects);
    if (!id) { if (matched) invalidMatches.add(row.id); continue; }
    const candidate = candidates.get(id) ?? { id, emails: [], phones: [] };
    if (row.email) candidate.emails.push(row.email);
    for (const p of [row.phone, row.whatsapp]) { const normalized = phone(p, false); if (normalized) candidate.phones.push(normalized); }
    candidates.set(id, candidate);
  }
  const selected = input.confirmedClientId ? canonicalTargetId(input.confirmedClientId, clients, redirects) : undefined;
  const match = matchHistoricalClient({ email: validEmail, phone: validPhone, confirmedClientId: input.confirmedClientId ? selected ?? input.confirmedClientId : undefined }, [...candidates.values()]);
  return invalidMatches.size ? { status: 'REVIEW' as const, clientId: null, candidates: [...new Set([...match.candidates, ...invalidMatches])].sort() } : match;
}

export type TargetRequest = { dialogueId: string; mode: 'EXISTING' | 'CREATE_PROPOSAL'; clientId?: string; subjectId?: string; displayName?: string };
const bounded = (value: unknown, limit: number) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= limit && !/[\x00-\x1f\x7f]/.test(value);
export function validateTargetRequest(value: unknown): TargetRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректное сопоставление');
  const r = value as Record<string, unknown>;
  if (!bounded(r.dialogueId, 512) || !['EXISTING', 'CREATE_PROPOSAL'].includes(String(r.mode))) throw new Error('Укажите исходный диалог');
  if (r.subjectId !== undefined && !bounded(r.subjectId, 512)) throw new Error('Некорректный идентификатор клиента источника');
  if (r.mode === 'EXISTING') {
    if (!bounded(r.clientId, 128) || r.displayName !== undefined) throw new Error('Выберите существующего клиента');
  } else if (r.clientId !== undefined || !bounded(r.subjectId, 512) || !bounded(r.displayName, 160)) throw new Error('Создание требует подтверждённой идентичности и имени');
  return { dialogueId: r.dialogueId as string, mode: r.mode as TargetRequest['mode'],
    clientId: r.clientId as string | undefined, subjectId: r.subjectId as string | undefined, displayName: r.displayName as string | undefined };
}
export function subjectIdentityKey(scope: { source: Source; account: string; channel: Channel }, subjectId: string) {
  return sha256(JSON.stringify([scope.source, scope.account, scope.channel, subjectId]));
}
