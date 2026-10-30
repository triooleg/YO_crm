/** Matches the API default. The server independently enforces quarantine limits. */
export const BACKUP_UPLOAD_LIMIT = 2 * 1024 ** 3;
export const BACKUP_POLL_MS = 4000;
export type BackupRecord = {
  id: string; type?: string; status?: string; createdAt?: string;
  sizeBytes?: string | number | null; checksum?: string | null;
  appVersion?: string | null; storageProvider?: string | null;
  metadata?: Record<string, unknown> | null;
};
export type BackupAction = 'create' | 'verify' | 'download' | 'upload' | 'drill' | 'recovery-plan';
type Command = { id?: string; type?: string; currentPassword?: string; confirmBackupId?: string; file?: File; idempotencyKey?: string; maxUploadBytes?: number };

export function backupObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function backupStatus(value: unknown): 'unknown' | 'pending' | 'running' | 'completed' | 'passed' | 'failed' | 'partial' | 'disabled' {
  const status = typeof value === 'string' ? value : backupObject(value).status;
  switch (status) {
    case 'PENDING': case 'QUEUED': return 'pending';
    case 'RUNNING': case 'VERIFYING': return 'running';
    case 'COMPLETED': return 'completed';
    case 'PASS': case 'PASSED': case 'VERIFIED': return 'passed';
    case 'FAILED': case 'FAIL': case 'ERROR': return 'failed';
    case 'PARTIAL': case 'EXTERNAL': case 'NOT_INCLUDED': return 'partial';
    case 'DISABLED': case 'UNCONFIGURED': case 'NOT_CONFIGURED': return 'disabled';
    default: return 'unknown';
  }
}

export function backupProgress(item: BackupRecord): number | null {
  const progress = backupObject(item.metadata?.job).progress;
  return typeof progress === 'number' && Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : null;
}

export function backupUploadLimit(value: unknown): number {
  const limit = typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value)) ? Number(value) : NaN;
  return Number.isSafeInteger(limit) && limit > 0 ? limit : BACKUP_UPLOAD_LIMIT;
}

export function backupUploadError(file?: Pick<File, 'size' | 'name'> | null, maxUploadBytes: number = BACKUP_UPLOAD_LIMIT): 'size' | 'type' | null {
  if (!file || file.size <= 0 || file.size > backupUploadLimit(maxUploadBytes)) return 'size';
  return /\.tar\.gz$/i.test(file.name) ? null : 'type';
}

/** Serialize only agreed fields; omitted sections are left unchanged by the API. */
export function backupRecoverySettings(value: unknown): Record<string, Record<string, boolean | number | string>> {
  const source = backupObject(value), result: Record<string, Record<string, boolean | number | string>> = {};
  for (const key of ['weeklyFull', 'monthlyDrill', 'retention', 'offsite', 'maintenance']) {
    if (!Object.hasOwn(source, key)) continue;
    const section = backupObject(source[key]), flag = key === 'maintenance' ? 'allowWriterPause' : 'enabled';
    if (typeof section[flag] !== 'boolean') throw new Error('recovery');
    const output: Record<string, boolean | number | string> = { [flag]: section[flag] };
    if (key === 'weeklyFull' || key === 'monthlyDrill') {
      const day = key === 'weeklyFull' ? 'dayOfWeek' : 'dayOfMonth', min = key === 'weeklyFull' ? 0 : 1, max = key === 'weeklyFull' ? 6 : 28;
      if (typeof section[day] !== 'number' || !Number.isInteger(section[day]) || section[day] < min || section[day] > max || typeof section.time !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(section.time)) throw new Error('recovery');
      output[day] = section[day]; output.time = section.time;
    }
    if (key === 'retention') {
      for (const count of ['daily', 'weekly', 'monthly', 'minimumVerified']) {
        if (!Object.hasOwn(section, count)) continue;
        const limit = section[count];
        if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > (count === 'minimumVerified' ? 10 : 365)) throw new Error('recovery');
        output[count] = limit;
      }
    }
    result[key] = output;
  }
  return result;
}

export async function backupRequest(action: BackupAction, command: Command, fetcher: typeof fetch = fetch): Promise<unknown> {
  const sensitive = ['download', 'upload', 'drill', 'recovery-plan'].includes(action);
  if (sensitive && !command.currentPassword?.trim()) throw new Error('password');
  if (action !== 'create' && action !== 'upload' && !command.id) throw new Error('id');
  if (action === 'recovery-plan' && command.confirmBackupId !== command.id) throw new Error('confirmation');
  if (action === 'upload' && backupUploadError(command.file, command.maxUploadBytes)) throw new Error('upload');
  const suffix = action === 'create' ? '' : action === 'upload' ? '/upload' : `/${encodeURIComponent(command.id!)}/${action}`;
  let body: BodyInit, headers: HeadersInit | undefined;
  if (action === 'upload') {
    const form = new FormData();
    form.append('currentPassword', command.currentPassword!);
    form.append('type', command.type || 'DATA');
    form.append('archive', command.file!);
    body = form;
  } else {
    const data = action === 'create' ? { type: command.type || 'DATA', ...(command.idempotencyKey ? { idempotencyKey: command.idempotencyKey } : {}) }
      : action === 'verify' ? {} : { currentPassword: command.currentPassword, ...(action === 'recovery-plan' ? { confirmBackupId: command.confirmBackupId } : {}) };
    body = JSON.stringify(data); headers = { 'Content-Type': 'application/json' };
  }
  const response = await fetcher(`/api/admin/backups${suffix}`, { method: 'POST', credentials: 'include', headers, body });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'reauth' : response.status === 413 ? 'upload' : 'request');
  if (action === 'download') {
    const contentType = response.headers.get('Content-Type') || '';
    if (!/application\/(?:gzip|x-gzip|octet-stream|x-tar)/i.test(contentType)) throw new Error('download');
    const blob = await response.blob();
    if (!blob.size) throw new Error('download');
    return blob;
  }
  return response.json();
}
