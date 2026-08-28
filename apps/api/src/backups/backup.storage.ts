import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { readFile, readdir, rm, stat } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";

export interface BackupStorage {
  readonly provider: "LOCAL" | "S3";
  list(): Promise<string[]>;
  exists(id: string): Promise<boolean>;
  verify(id: string): Promise<{ checksum: string; sizeBytes: bigint }>;
  remove(id: string): Promise<void>;
}

export const BACKUP_STORAGE = Symbol("BACKUP_STORAGE");

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
    const expected = new Map(sums.trim().split(/\r?\n/).map(line => {
      const match = /^([a-f0-9]{64})\s+\*?([A-Za-z0-9._-]+)$/.exec(line.trim());
      if (!match) throw new Error("Некорректный файл SHA256SUMS");
      return [match[2], match[1]];
    }));
    for (const name of ["postgres.dump", "uploads.tar.gz", "manifest.json"]) {
      const digest = expected.get(name);
      if (!digest) throw new Error(`Отсутствует checksum для ${name}`);
      const bytes = name === "manifest.json" ? manifest : await readFile(join(directory, name));
      if (createHash("sha256").update(bytes).digest("hex") !== digest) throw new Error(`Checksum не совпадает: ${name}`);
    }
    const files = await Promise.all(["postgres.dump", "uploads.tar.gz", "manifest.json", "SHA256SUMS"].map(name => stat(join(directory, name))));
    return { checksum: createHash("sha256").update(manifest).digest("hex"), sizeBytes: files.reduce((sum, file) => sum + BigInt(file.size), 0n) };
  }

  async remove(id: string) {
    const target = this.directory(id);
    if (!(await this.exists(id))) throw new Error("Резервная копия не найдена в хранилище");
    await rm(target, { recursive: true, force: false });
  }
}
