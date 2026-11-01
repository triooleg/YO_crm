export type HistoryOperationalPreview = {
  previewDigest: string; sourceDigest: string; clientId: string;
  preview: { discovered: number; newCandidates: number; alreadyExists: number; review: number; conflicts: number; blockers: string[]; sourceCompleteness: 'UNVERIFIED' };
};
export type HistoryOperationalRun = { runId: string; status: 'APPLIED' | 'ROLLED_BACK'; added: number };
export type HistoryOperationalStatus = {
  enabled: boolean; prepared: boolean; expiresAt: string | null; grantReady: boolean; previewDigest: string | null; run: HistoryOperationalRun | null;
};
export type HistoryOperationalResult = { runId: string; added: number; alreadyExists: number; replayed: boolean; productionImport: true };
export class HistoryOperationalApiError extends Error {
  constructor(readonly unavailable = false) { super('HISTORY_OPERATIONAL_REQUEST_FAILED'); }
}

function requireValue(value: unknown): asserts value { if (!value) throw new HistoryOperationalApiError(); }
const object = (value: unknown): Record<string, unknown> => {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value));
  return value as Record<string, unknown>;
};
const identifier = (value: unknown): string => { requireValue(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)); return value; };
const digest = (value: unknown): string => { requireValue(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)); return value; };
const count = (value: unknown): number => { requireValue(typeof value === 'number' && Number.isSafeInteger(value) && value >= 0); return value; };
const boolean = (value: unknown): boolean => { requireValue(typeof value === 'boolean'); return value; };
const password = (value: string): string => { requireValue(typeof value === 'string' && value.length > 0); return value; };
function parsePreview(value: unknown): HistoryOperationalPreview {
  const row = object(value), report = object(row.preview);
  requireValue(report.sourceCompleteness === 'UNVERIFIED' && Array.isArray(report.blockers) && report.blockers.every(item => typeof item === 'string'));
  return {previewDigest:digest(row.previewDigest),sourceDigest:digest(row.sourceDigest),clientId:identifier(row.clientId),preview:{
    discovered:count(report.discovered),newCandidates:count(report.newCandidates),alreadyExists:count(report.alreadyExists),
    review:count(report.review),conflicts:count(report.conflicts),blockers:[...report.blockers],sourceCompleteness:'UNVERIFIED',
  }};
}
function parseStatus(value: unknown): HistoryOperationalStatus {
  const row = object(value);
  requireValue(row.expiresAt === null || (typeof row.expiresAt === 'string' && Number.isFinite(Date.parse(row.expiresAt))));
  let run: HistoryOperationalRun | null = null;
  if (row.run !== null) {
    const current = object(row.run);
    requireValue(current.status === 'APPLIED' || current.status === 'ROLLED_BACK');
    run = {runId:identifier(current.runId),status:current.status,added:count(current.added)};
  }
  return {enabled:boolean(row.enabled),prepared:boolean(row.prepared),expiresAt:row.expiresAt as string | null,
    grantReady:boolean(row.grantReady),previewDigest:row.previewDigest === null ? null : digest(row.previewDigest),run};
}

/** Cookie-authenticated owner API only. Never consume error bodies, retain
 * credentials, or expose server-only grant/alias fields through response spreads.
 */
export function createHistoryOperationalApi(fetcher: typeof fetch = (path, init) => fetch(path, init)) {
  const base = (id: string) => `/api/admin/history-migration/jobs/${encodeURIComponent(identifier(id))}/operational`;
  async function request<T>(path: string, signal: AbortSignal, parse: (value: unknown) => T, body?: unknown): Promise<T> {
    const response = await fetcher(path, {method:body === undefined ? 'GET' : 'POST',credentials:'include',cache:'no-store',redirect:'error',signal,
      headers:body === undefined ? undefined : {'Content-Type':'application/json'},body:body === undefined ? undefined : JSON.stringify(body)});
    if (!response.ok) throw new HistoryOperationalApiError(response.status === 404);
    return parse(await response.json());
  }
  return {
    preview: (id: string, signal: AbortSignal) => request(base(id)+'/preview',signal,parsePreview,{}),
    prepare: (id: string, currentPassword: string, signal: AbortSignal) => request(base(id)+'/prepare',signal,parsePreview,{currentPassword:password(currentPassword)}),
    status: (id: string, signal: AbortSignal) => request(base(id)+'/status',signal,parseStatus),
    apply: (id: string, previewDigest: string, currentPassword: string, signal: AbortSignal) => request(base(id)+'/apply',signal,value => {
      const row = object(value); requireValue(row.productionImport === true);
      return {runId:identifier(row.runId),added:count(row.added),alreadyExists:count(row.alreadyExists),replayed:boolean(row.replayed),productionImport:true} as HistoryOperationalResult;
    },{previewDigest:digest(previewDigest),currentPassword:password(currentPassword)}),
    rollback: (id: string, runId: string, currentPassword: string, signal: AbortSignal) => request(base(id)+'/runs/'+encodeURIComponent(identifier(runId))+'/rollback',signal,value => {
      requireValue(object(value).rolledBack === true); return {rolledBack:true as const};
    },{currentPassword:password(currentPassword)}),
  };
}
export const historyOperationalApi = createHistoryOperationalApi();
