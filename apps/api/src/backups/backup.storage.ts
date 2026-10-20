import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

export interface BackupStorage {
  readonly provider: "LOCAL" | "S3";
  list(): Promise<string[]>;
  exists(id: string): Promise<boolean>;
  verify(id: string): Promise<{ checksum: string; sizeBytes: bigint; manifest: BackupManifest }>;
  remove(id: string): Promise<void>;
}

export const BACKUP_STORAGE = Symbol("BACKUP_STORAGE");

type BackupManifest = {
  format_version: 2;
  backup_id: string;
  type: "data" | "full";
  app_version: string;
  git_commit: string;
  schema_version: string;
  database_version: string;
  storage_provider: "local";
  files: ["postgres.dump", "uploads.tar.gz"];
};

function parseManifest(bytes: Buffer, expectedId: string): BackupManifest {
  let value: unknown;
  try { value = JSON.parse(bytes.toString("utf8")); } catch { throw new Error("Некорректный JSON manifest"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Некорректный manifest");
  const item = value as Record<string, unknown>;
  if (item.format_version !== 2 || item.backup_id !== expectedId) throw new Error("Manifest не соответствует резервной копии");
  if (item.type !== "data" && item.type !== "full") throw new Error("Некорректный тип резервной копии");
  for (const key of ["app_version", "git_commit", "schema_version", "database_version"] as const) {
    if (typeof item[key] !== "string" || !item[key]) throw new Error(`Отсутствует поле manifest: ${key}`);
  }
  if (item.storage_provider !== "local" || !Array.isArray(item.files) || item.files.length !== 2 || item.files[0] !== "postgres.dump" || item.files[1] !== "uploads.tar.gz") throw new Error("Некорректный состав резервной копии");
  return item as BackupManifest;
}

async function sha256File(path: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
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
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/.test(id)) throw new Error("Некорректный идентификатор резервной копии");
    const target = resolve(this.root, id);
    if (!target.startsWith(this.root + sep)) throw new Error("Путь резервной копии выходит за пределы хранилища");
    return target;
  }

  async list() {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    });
    return entries.filter(entry => entry.isDirectory()).map(entry => entry.name).filter(id => /^[a-zA-Z0-9][a-zA-Z0-9._-]{7,127}$/.test(id));
  }

  async exists(id: string) {
    return Boolean(await stat(join(this.directory(id), "manifest.json")).catch(() => null));
  }

  async verify(id: string) {
    const directory = this.directory(id);
    const [manifest, sums] = await Promise.all([
      readFile(join(directory, "manifest.json")),
      readFile(join(directory, "SHA256SUMS"), "utf8"),
    ]);
    const parsedManifest = parseManifest(manifest, id);
    const expected = new Map(sums.trim().split(/\r?\n/).map(line => {
      const match = /^([a-f0-9]{64})\s+\*?([A-Za-z0-9._-]+)$/.exec(line.trim());
      if (!match) throw new Error("Некорректный файл SHA256SUMS");
      return [match[2], match[1]];
    }));
    for (const name of ["postgres.dump", "uploads.tar.gz", "manifest.json"]) {
      const digest = expected.get(name);
      if (!digest) throw new Error(`Отсутствует checksum для ${name}`);
      const actual = name === "manifest.json"
        ? createHash("sha256").update(manifest).digest("hex")
        : await sha256File(join(directory, name));
      if (actual !== digest) throw new Error(`Checksum не совпадает: ${name}`);
    }
    const files = await Promise.all(["postgres.dump", "uploads.tar.gz", "manifest.json", "SHA256SUMS"].map(name => stat(join(directory, name))));
    return { checksum: createHash("sha256").update(manifest).digest("hex"), sizeBytes: files.reduce((sum, file) => sum + BigInt(file.size), 0n), manifest: parsedManifest };
  }

  async remove(id: string) {
    const target = this.directory(id);
    if (!(await this.exists(id))) throw new Error("Резервная копия не найдена в хранилище");
    await rm(target, { recursive: true, force: false });
  }
}
