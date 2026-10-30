import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { constants, type ReadStream } from "node:fs";
import { lstat, open, opendir, readdir, realpath, rm, type FileHandle } from "node:fs/promises";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import { parseBackupJson } from "./backup.json";

export type BackupManifest = {
  format_version: 1 | 2 | 3; backup_id: string; type: "data" | "full";
  app_version?: string; git_commit?: string; schema_version?: string; database_version?: string;
  storage_provider: "local"; files: string[];
  legacy_identity_verified?: false;
};
export interface BackupStorage {
  readonly provider: "LOCAL" | "S3";
  list(): Promise<string[]>;
  exists(id: string): Promise<boolean>;
  verify(id: string, expectedManifestId?: string): Promise<{ checksum: string; sizeBytes: bigint; manifest: BackupManifest }>;
  openArchive?(id: string, checksum: string, bytes: bigint): Promise<ReadStream>;
  remove(id: string): Promise<void>;
}
export const BACKUP_STORAGE = Symbol("BACKUP_STORAGE");
export const safeBackupId = (id: string) => /^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/.test(id);
const safeFile = (name: unknown): name is string => typeof name === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(name);
export const byteLimit = (name: string, fallback: number) => {
  const value = process.env[name];
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`Некорректный лимит ${name}`);
  return parsed;
};
// Check every ancestor too: a safe leaf below a linked parent is still unsafe.
export async function assertPrivateDirectory(path: string) {
  const target = resolve(path); let current = parse(target).root;
  for (const part of target.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Небезопасный каталог резервных копий");
  }
  if (resolve(await realpath(target)).toLowerCase() !== target.toLowerCase()) throw new Error("Каталог перенаправлен");
}
function parseManifest(bytes: Buffer, expectedId: string): BackupManifest {
  let value: unknown;
  try { value = parseBackupJson(bytes); } catch { throw new Error("Некорректный JSON manifest"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректный manifest");
  const item = value as Record<string, unknown>;
  if (![2, 3].includes(item.format_version as number) || item.backup_id !== expectedId) throw new Error("Manifest не соответствует резервной копии");
  if (item.type !== "data" && item.type !== "full") throw new Error("Некорректный тип резервной копии");
  for (const key of ["app_version", "git_commit", "schema_version", "database_version"] as const) {
    if (typeof item[key] !== "string" || !item[key] || item[key].length > 1024) throw new Error(`Отсутствует поле manifest: ${key}`);
  }
  if (item.storage_provider !== "local" || !Array.isArray(item.files) || item.files.length < 2 || item.files.length > 64 || !item.files.every(safeFile) || new Set(item.files).size !== item.files.length || !item.files.includes("postgres.dump") || !item.files.includes("uploads.tar.gz") || item.files.some(name => ["manifest.json", "SHA256SUMS", "archive.tar.gz"].includes(name))) throw new Error("Некорректный состав резервной копии");
  if (item.format_version === 2 && (item.files.length !== 2 || item.files[0] !== "postgres.dump" || item.files[1] !== "uploads.tar.gz")) throw new Error("Некорректный состав v2");
  if (item.format_version === 3) {
    const consistency = item.consistency as { verified?: unknown } | null;
    if (consistency?.verified !== true || item.files[0] !== "postgres.dump" || item.files[1] !== "uploads.tar.gz" || !item.files.includes("inventory.json") || !item.files.includes("table-counts.json") || (item.type === "full" && !item.files.includes("application.tar.gz"))) throw new Error("Отсутствует обязательный состав и подтверждение consistency v3");
  }
  return item as BackupManifest;
}
function parseLegacyManifest(bytes: Buffer, expectedId: string): BackupManifest {
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(bytes).split(/\r?\n/);
  if (!lines.includes("format_version=1") || !lines.includes("compose_project=yoleotard-crm")) throw new Error("Некорректный legacy manifest");
  for (const key of ["format_version", "compose_project"]) {
    if (lines.filter(line => line.startsWith(`${key}=`)).length !== 1) throw new Error("Повторное поле legacy manifest");
  }
  // v1 has no authenticated identity or type. This is presentation only; keep
  // the original manifest bytes for checksum and default its data payload to DATA.
  return { format_version: 1, backup_id: expectedId, type: "data", storage_provider: "local", files: ["postgres.dump", "uploads.tar.gz"], legacy_identity_verified: false };
}
async function safeOpen(path: string, max: number): Promise<FileHandle> {
  await assertPrivateDirectory(dirname(path));
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > max) throw new Error("Небезопасный файл или превышен лимит");
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const after = await handle.stat();
    if (!after.isFile() || before.dev !== after.dev || before.ino !== after.ino || after.size > max) throw new Error("Файл изменён во время открытия");
    return handle;
  } catch (error) { await handle.close(); throw error; }
}
async function hashHandle(handle: FileHandle, max: number) {
  const hash = createHash("sha256"); let bytes = 0;
  for await (const chunk of handle.createReadStream({ autoClose: false, start: 0 })) {
    bytes += chunk.length; if (bytes > max) throw new Error("Превышен лимит файла"); hash.update(chunk);
  }
  return { checksum: hash.digest("hex"), bytes };
}
@Injectable()
export class LocalBackupStorage implements BackupStorage {
  readonly provider = "LOCAL" as const;
  private readonly root: string;
  constructor() {
    const configured = process.env.BACKUP_STORAGE_PATH || "/backups";
    if (!isAbsolute(configured)) throw new Error("BACKUP_STORAGE_PATH должен быть абсолютным путём");
    this.root = resolve(configured);
  }
  private directory(id: string) {
    if (!safeBackupId(id)) throw new Error("Некорректный идентификатор резервной копии");
    const target = resolve(this.root, id);
    if (!target.startsWith(this.root + sep)) throw new Error("Путь резервной копии выходит за пределы хранилища");
    return target;
  }
  async list() {
    await assertPrivateDirectory(this.root);
    return (await readdir(this.root, { withFileTypes: true })).filter(entry => entry.isDirectory() && safeBackupId(entry.name)).map(entry => entry.name);
  }
  async exists(id: string) {
    for (const name of ["manifest.json", "manifest.txt"]) {
      try { const handle = await safeOpen(join(this.directory(id), name), 1024 * 1024); await handle.close(); return true; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    return false;
  }
  async verify(id: string, expectedManifestId = id) {
    const directory = this.directory(id);
    if (!safeBackupId(expectedManifestId)) throw new Error("Некорректный исходный идентификатор");
    const readBounded = async (name: string, limit = 1024 * 1024) => {
      const handle = await safeOpen(join(directory, name), limit);
      try {
        const info = await handle.stat();
        if (info.size > limit) throw new Error("Превышен лимит файла");
        const bytes = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < bytes.length) {
          const result = await handle.read(bytes, offset, bytes.length - offset, offset);
          if (!result.bytesRead) throw new Error("Файл изменён во время чтения");
          offset += result.bytesRead;
        }
        if ((await handle.stat()).size !== bytes.length) throw new Error("Файл изменён во время чтения");
        return bytes;
      }
      finally { await handle.close(); }
    };
    let manifestName = "manifest.json", manifest: Buffer;
    try { manifest = await readBounded(manifestName); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      manifestName = "manifest.txt"; manifest = await readBounded(manifestName, 65535);
    }
    const sums = await readBounded("SHA256SUMS");
    const parsedManifest = manifestName === "manifest.json" ? parseManifest(manifest, expectedManifestId) : parseLegacyManifest(manifest, expectedManifestId);
    const max = byteLimit("BACKUP_VERIFY_MAX_BYTES", 64 * 1024 ** 3);
    const allowed = new Set([...parsedManifest.files, "manifest.json", "SHA256SUMS", "manifest.txt", "archive.tar.gz", "archive.sha256", ".backup-owner", "verification.json", "drill-report.json"]);
    let entries = 0, diskBytes = 0n;
    for await (const entry of await opendir(directory)) {
      if (++entries > 80 || !allowed.has(entry.name)) throw new Error("Неожиданный файл резервной копии");
      const info = await lstat(join(directory, entry.name));
      if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1) throw new Error("Небезопасный файл резервной копии");
      diskBytes += BigInt(info.size);
      if (diskBytes > BigInt(max)) throw new Error("Превышен лимит каталога резервной копии");
    }
    const expected = new Map<string, string>();
    for (const line of sums.toString("utf8").trim().split(/\r?\n/)) {
      const match = /^([a-f0-9]{64})\s+\*?([A-Za-z0-9._-]+)$/.exec(line);
      if (!match || !match[1] || !match[2] || expected.has(match[2])) throw new Error("Некорректный файл SHA256SUMS");
      expected.set(match[2], match[1]);
    }
    const names = [...parsedManifest.files, ...(parsedManifest.format_version === 1 ? [] : ["manifest.json"])];
    const optionalLegacy = expected.has("manifest.txt") && !names.includes("manifest.txt");
    if (optionalLegacy) names.push("manifest.txt");
    if (expected.size !== names.length || names.some(name => !expected.has(name))) throw new Error("Состав checksum не соответствует manifest");
    let sizeBytes = BigInt(sums.length + (parsedManifest.format_version === 1 ? manifest.length : 0));
    for (const name of names) {
      const handle = await safeOpen(join(directory, name), max);
      try {
        const actual = await hashHandle(handle, max);
        if (actual.checksum !== expected.get(name)) throw new Error(`Checksum не совпадает: ${name}`);
        if (name === manifestName && actual.checksum !== createHash("sha256").update(manifest).digest("hex")) throw new Error("Manifest изменён во время проверки");
        if (!(optionalLegacy && name === "manifest.txt")) sizeBytes += BigInt(actual.bytes);
        if (sizeBytes > BigInt(max)) throw new Error("Превышен общий лимит резервной копии");
      } finally { await handle.close(); }
    }
    return { checksum: createHash("sha256").update(manifest).digest("hex"), sizeBytes, manifest: parsedManifest };
  }
  async openArchive(id: string, checksum: string, bytes: bigint) {
    if (!/^[a-f0-9]{64}$/.test(checksum) || bytes < 1n) throw new Error("Некорректные метаданные архива");
    const max = byteLimit("BACKUP_DOWNLOAD_MAX_BYTES", 64 * 1024 ** 3);
    const handle = await safeOpen(join(this.directory(id), "archive.tar.gz"), max);
    try {
      const actual = await hashHandle(handle, max);
      if (actual.checksum !== checksum || BigInt(actual.bytes) !== bytes) throw new Error("Архив не соответствует метаданным");
      return handle.createReadStream({ start: 0, end: actual.bytes - 1, autoClose: true });
    } catch (error) { await handle.close(); throw error; }
  }
  async remove(id: string) {
    const target = this.directory(id); await assertPrivateDirectory(target);
    if (!(await this.exists(id))) throw new Error("Резервная копия не найдена в хранилище");
    await rm(target, { recursive: true, force: false });
  }
}
