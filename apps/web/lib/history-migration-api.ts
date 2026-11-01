export type HistoryMigrationJob = {
  jobId: string; status: 'STAGING' | 'CLOSED'; source: 'KEYCRM'; account: string; channel: string;
  batchCount: number; messageCount: number; payloadBytes: number; agentRevision: number;
  agentExpiresAt: string | null; importEnabled: false; createdAt: string;
};
export type HistoryMigrationJobPage = { jobs: HistoryMigrationJob[]; nextCursor: string | null };
export type HistoryMigrationTarget = {
  targetId: string; dialogueId: string; mode: string; clientId: string | null; revision: number;
};
export type HistoryMigrationDetail = HistoryMigrationJob & {
  planningEnabled: boolean; agentPaired: boolean;
  intakeLocked?: boolean; operationalApplied?: boolean;
  dialogs: { dialogueId: string; channel: string; messageCount: number }[];
  targets: HistoryMigrationTarget[];
};
export type HistoryMigrationCandidate = { clientId: string; displayName: string; archived: boolean };
export type HistoryMigrationResolution = {
  status: string; clientId: string | null; candidates: HistoryMigrationCandidate[]; persisted: false;
};
export type HistoryMigrationPreview = {
  previewDigest: string; crmCompared: boolean; sourceCompleteness: 'UNVERIFIED';
  discovered: number | null; newCandidates: number | null; alreadyExists: number | null;
  review: number | null; conflicts: number | null; blockers: string[]; productionBlockers: string[];
  importEnabled: false; addedToCrm: 0; targets: unknown[]; actions: unknown[];
};
export type HistoryMigrationPair = { jobId: string; token: string; expiresAt: string; importEnabled: false };
export type HistoryMigrationTargetInput =
  | { dialogueId: string; mode: 'EXISTING'; clientId: string; currentPassword: string }
  | { dialogueId: string; mode: 'CREATE_PROPOSAL'; subjectId: string; displayName: string; ownerAttested: true; currentPassword: string };

// Never read server error bodies: they may echo credentials or source payloads.
export class HistoryMigrationApiError extends Error {
  constructor(readonly unavailable = false) { super('HISTORY_MIGRATION_REQUEST_FAILED'); }
}
const base = '/api/admin/history-migration/jobs';
async function request<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST', credentials: 'include', redirect: 'error', cache: 'no-store', signal,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new HistoryMigrationApiError(body === undefined && response.status === 404);
  if (response.status === 204) return undefined as T;
  return await response.json() as T;
}
const jobPath = (id: string) => `${base}/${encodeURIComponent(id)}`;
export const historyMigrationApi = {
  list: async (signal: AbortSignal, cursor?: string) => {
    const page = await request<HistoryMigrationJobPage>(cursor ? `${base}?cursor=${encodeURIComponent(cursor)}` : base, signal);
    if (!Array.isArray(page.jobs) || page.jobs.length > 50 || (page.nextCursor !== null && typeof page.nextCursor !== 'string')) throw new HistoryMigrationApiError();
    return page;
  },
  detail: (id: string, signal: AbortSignal) => request<HistoryMigrationDetail>(jobPath(id), signal),
  create: (body: { source: 'KEYCRM'; account: string; channel: string; currentPassword: string }, signal: AbortSignal) => request<Omit<HistoryMigrationJob, 'createdAt'>>(base, signal, body),
  pair: (id: string, currentPassword: string, signal: AbortSignal) => request<HistoryMigrationPair>(`${jobPath(id)}/pair`, signal, { currentPassword }),
  revoke: (id: string, currentPassword: string, signal: AbortSignal) => request<unknown>(`${jobPath(id)}/revoke`, signal, { currentPassword }),
  close: (id: string, currentPassword: string, signal: AbortSignal) => request<unknown>(`${jobPath(id)}/close`, signal, { currentPassword }),
  resolve: (id: string, body: { dialogueId: string; email?: string; phone?: string }, signal: AbortSignal) => request<HistoryMigrationResolution>(`${jobPath(id)}/targets/resolve`, signal, body),
  target: (id: string, body: HistoryMigrationTargetInput, signal: AbortSignal) => request<unknown>(`${jobPath(id)}/targets`, signal, body),
  preview: (id: string, signal: AbortSignal) => request<HistoryMigrationPreview>(`${jobPath(id)}/dry-run`, signal),
  search: async (search: string, signal: AbortSignal): Promise<HistoryMigrationCandidate[]> => {
    if (search.trim().length < 2) return [];
    const rows = await request<{ id: string; displayName: string; archivedAt?: string | null; status?: string }[]>(`/api/clients?search=${encodeURIComponent(search.trim())}`, signal);
    return rows.slice(0, 50).map(row => ({ clientId: row.id, displayName: row.displayName, archived: Boolean(row.archivedAt) || row.status === 'ARCHIVED' }));
  },
};
