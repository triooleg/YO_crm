import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve, sep } from 'node:path';
import { decryptSecret } from '../secret-box';
import { parseBackupJson } from './backup.json';

export const OPERATIONAL_BACKUP_GRANT_PURPOSE = 'OPERATIONAL_NATIVE_BACKUP_GRANT_V1' as const;
const MAX_GRANT_BYTES = 64 * 1024;

export type OperationalBackupGrantContext = {
  jobId: string;
  actorId: string;
  clientId: string;
  sourceDigest: string;
  previewDigest: string;
  candidateSnapshot: string;
  targetIdentity: { cluster: string; databaseName: string; databaseOid: number };
  migrationSetDigest: string;
};
export type OperationalBackupGrantPayload = OperationalBackupGrantContext & {
  version: 1;
  purpose: typeof OPERATIONAL_BACKUP_GRANT_PURPOSE;
  grantId: string;
  backupId: string;
  captureStartedAt: string;
  manifestSha256: string;
  sha256sumsSha256: string;
  archiveSha256: string;
  archiveBytes: string;
  drillJobId: string;
  drillReportSha256: string;
  drillFinishedAt: string;
  issuedAt: string;
  expiresAt: string;
};

const CONTEXT_KEYS = ['jobId', 'actorId', 'clientId', 'sourceDigest', 'previewDigest', 'candidateSnapshot', 'targetIdentity', 'migrationSetDigest'];
const PAYLOAD_KEYS = [...CONTEXT_KEYS, 'version', 'purpose', 'grantId', 'backupId', 'captureStartedAt', 'manifestSha256', 'sha256sumsSha256', 'archiveSha256', 'archiveBytes', 'drillJobId', 'drillReportSha256', 'drillFinishedAt', 'issuedAt', 'expiresAt'];
function requireGrant(condition: unknown): asserts condition {
  if (!condition) throw new Error('OPERATIONAL_BACKUP_GRANT_INVALID');
}
function exactObject(value: unknown, keys: readonly string[]): Record<string, unknown> {
  requireGrant(value !== null && typeof value === 'object' && !Array.isArray(value));
  const own = Reflect.ownKeys(value);
  requireGrant(own.length === keys.length && own.every(key => typeof key === 'string' && keys.includes(key) && 'value' in Object.getOwnPropertyDescriptor(value, key)!));
  return value as Record<string, unknown>;
}
function uuid(value: unknown): asserts value is string {
  // Same UUID-v4 contract as migrationId, without importing the history engine.
  requireGrant(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}
function text(value: unknown, max = 256): asserts value is string {
  requireGrant(typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value && !/[\x00-\x1f\x7f]/.test(value));
}
function unsigned(value: unknown, maximum: bigint): void {
  requireGrant(typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value) && BigInt(value) <= maximum);
}
function checkContext(value: unknown): Record<string, unknown> {
  const ctx = exactObject(value, CONTEXT_KEYS);
  uuid(ctx.jobId); text(ctx.actorId); text(ctx.clientId);
  for (const key of ['sourceDigest', 'previewDigest', 'candidateSnapshot', 'migrationSetDigest']) {
    requireGrant(typeof ctx[key] === 'string' && /^[a-f0-9]{64}$/.test(ctx[key]));
  }
  const db = exactObject(ctx.targetIdentity, ['cluster', 'databaseName', 'databaseOid']);
  unsigned(db.cluster, 18446744073709551615n); text(db.databaseName, 63);
  requireGrant(typeof db.databaseOid === 'number' && Number.isInteger(db.databaseOid) && db.databaseOid > 0 && db.databaseOid <= 4294967295);
  return ctx;
}
function timestamp(value: unknown): bigint {
  requireGrant(typeof value === 'string');
  const match = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,6}))?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.exec(value);
  requireGrant(match);
  const calendar = new Date(match[1] + 'T00:00:00.000Z');
  requireGrant(Number.isFinite(calendar.getTime()) && calendar.toISOString().slice(0, 10) === match[1]);
  const milliseconds = Date.parse(value);
  requireGrant(Number.isFinite(milliseconds));
  // Python host receipts use microseconds. Do not truncate a future/expired
  // timestamp into the current JS millisecond and accidentally admit it.
  return BigInt(milliseconds) * 1000n + BigInt((match[5] ?? '').padEnd(6, '0').slice(3));
}

/** Schema/context validation only. Production callers must enter through the authenticated file reader. */
export function validateOperationalBackupGrant(value: unknown, grantId: string, expected: OperationalBackupGrantContext, now = new Date()): OperationalBackupGrantPayload {
  uuid(grantId);
  const body = exactObject(value, PAYLOAD_KEYS);
  requireGrant(body.version === 1 && body.purpose === OPERATIONAL_BACKUP_GRANT_PURPOSE && body.grantId === grantId);
  const ctx = checkContext(Object.fromEntries(CONTEXT_KEYS.map(key => [key, body[key]])));
  const trusted = checkContext(expected);
  for (const key of CONTEXT_KEYS.filter(key => key !== 'targetIdentity')) requireGrant(ctx[key] === trusted[key]);
  const db = ctx.targetIdentity as Record<string, unknown>, expectedDb = trusted.targetIdentity as Record<string, unknown>;
  requireGrant(['cluster', 'databaseName', 'databaseOid'].every(key => db[key] === expectedDb[key]));
  for (const key of ['manifestSha256', 'sha256sumsSha256', 'archiveSha256', 'drillReportSha256']) requireGrant(typeof body[key] === 'string' && /^[a-f0-9]{64}$/.test(body[key]));
  for (const key of ['backupId', 'drillJobId']) requireGrant(typeof body[key] === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/.test(body[key]));
  unsigned(body.archiveBytes, 18446744073709551615n);
  requireGrant(now instanceof Date && Number.isFinite(now.getTime()));
  const current = BigInt(now.getTime()) * 1000n;
  const capture = timestamp(body.captureStartedAt), drill = timestamp(body.drillFinishedAt);
  const issued = timestamp(body.issuedAt), expires = timestamp(body.expiresAt);
  requireGrant(capture <= drill && drill <= issued && issued <= current && issued < expires);
  requireGrant(current >= capture && current - capture <= 7200_000_000n && current < expires && expires <= capture + 7200_000_000n);
  return structuredClone(body) as OperationalBackupGrantPayload;
}

type DirectoryIdentity = { path: string; stat: BigIntStats };
function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.uid === right.uid && left.gid === right.gid;
}
function sameFile(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right) && left.size === right.size && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs && left.nlink === right.nlink;
}
function hostOwned(stat: BigIntStats): void {
  // POSIX ownership is enforceable here. On Windows the installer/operator must
  // supply the equivalent ACL; mode bits do not establish a Windows ACL.
  if (process.platform !== 'win32') requireGrant(stat.uid === 0n && (stat.mode & 0o022n) === 0n);
}
async function directoryIdentities(directory: string): Promise<DirectoryIdentity[]> {
  const root = parse(directory).root;
  let current = root;
  const result: DirectoryIdentity[] = [];
  for (const part of [root, ...directory.slice(root.length).split(sep).filter(Boolean)]) {
    current = part === root ? root : join(current, part);
    const stat = await lstat(current, { bigint: true });
    requireGrant(stat.isDirectory() && !stat.isSymbolicLink() && stat.ino > 0n);
    result.push({ path: current, stat });
  }
  hostOwned(result[result.length - 1]!.stat);
  const actual = await realpath(directory);
  requireGrant(process.platform === 'win32' ? actual.toLowerCase() === directory.toLowerCase() : actual === directory);
  return result;
}
function regularFile(stat: BigIntStats): void {
  requireGrant(stat.isFile() && !stat.isSymbolicLink() && stat.ino > 0n && stat.nlink === 1n && stat.size > 0n && stat.size <= BigInt(MAX_GRANT_BYTES));
  hostOwned(stat);
}
function decryptGrant(bytes: Buffer): unknown {
  const encoded = bytes.toString('utf8');
  requireGrant(Buffer.from(encoded, 'utf8').equals(bytes));
  const parts = encoded.split('.');
  requireGrant(parts.length === 4 && parts[0] === 'v1');
  for (const part of parts.slice(1)) {
    requireGrant(/^[A-Za-z0-9_-]+$/.test(part) && Buffer.from(part, 'base64url').toString('base64url') === part);
  }
  requireGrant(Buffer.from(parts[1]!, 'base64url').length === 12 && Buffer.from(parts[3]!, 'base64url').length === 16);
  return parseBackupJson(Buffer.from(decryptSecret(encoded), 'utf8'));
}

/**
 * Internal boot configuration only: never construct from an HTTP URL/path/DTO.
 * The host alone must be able to write this directory, mounted read-only into
 * the API. A shared AES key authenticates bytes, not exclusive host authorship.
 * Windows ACLs and the read-only mount are deployment prerequisites, not claims
 * made by this reader. Grant consumption, artifact/fence checks and issuer are
 * deliberately outside this module; reading a grant does not authorize apply.
 */
export class OperationalBackupGrantReader {
  private readonly directory: string;
  constructor(directory = process.env.HISTORY_OPERATIONAL_GRANTS_DIR ?? '/run/yoleotard-crm/history-operational-grants') {
    requireGrant(typeof directory === 'string' && isAbsolute(directory) && !directory.includes('\0') && !directory.startsWith('\\\\') && !directory.startsWith('//'));
    this.directory = resolve(directory);
  }
  async read(grantId: string, expected: OperationalBackupGrantContext, now?: Date): Promise<{ grant: OperationalBackupGrantPayload; digest: string }> {
    let handle: FileHandle | undefined;
    try {
      uuid(grantId);
      const directories = await directoryIdentities(this.directory);
      const path = join(this.directory, grantId + '.grant');
      const before = await lstat(path, { bigint: true });
      regularFile(before);
      try { handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
      catch (error) {
        // Some Windows filesystems lack O_NOFOLLOW. Only unsupported-flag
        // failures permit fallback; identity/path checks remain mandatory.
        requireGrant(process.platform === 'win32' && ['EINVAL', 'ENOTSUP', 'ENOSYS'].includes((error as NodeJS.ErrnoException).code ?? ''));
        handle = await open(path, constants.O_RDONLY);
      }
      const opened = await handle.stat({ bigint: true });
      regularFile(opened); requireGrant(sameFile(before, opened));
      const buffer = Buffer.alloc(MAX_GRANT_BYTES + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      requireGrant(length > 0 && length <= MAX_GRANT_BYTES && BigInt(length) === opened.size);
      const after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
      regularFile(after); regularFile(named);
      requireGrant(sameFile(opened, after) && sameFile(after, named));
      for (const directory of directories) {
        const stat = await lstat(directory.path, { bigint: true });
        requireGrant(stat.isDirectory() && !stat.isSymbolicLink() && sameIdentity(directory.stat, stat));
      }
      const bytes = buffer.subarray(0, length);
      const grant = validateOperationalBackupGrant(decryptGrant(bytes), grantId, expected, now ?? new Date());
      return { grant, digest: createHash('sha256').update(bytes).digest('hex') };
    } catch {
      // Never expose a configured path, plaintext evidence or crypto diagnostic.
      throw new Error('OPERATIONAL_BACKUP_GRANT_INVALID');
    } finally { await handle?.close(); }
  }
}
