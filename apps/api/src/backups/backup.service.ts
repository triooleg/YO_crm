import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { BackupType, type Backup, type User } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { BACKUP_STORAGE, type BackupStorage } from "./backup.storage";
import { BackupRepository } from "./backup.repository";

const present = (backup: Backup) => ({ ...backup, sizeBytes: backup.sizeBytes?.toString() ?? null });

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);
  constructor(private readonly repository: BackupRepository, @Inject(BACKUP_STORAGE) private readonly storage: BackupStorage) {}

  async listBackups() { return (await this.repository.list()).map(present); }
  async getBackup(id: string) { const item = await this.repository.get(id); if (!item) throw new NotFoundException("Резервная копия не найдена"); return present(item); }
  async settings() { return this.repository.settings(); }
  async saveSettings(input: Parameters<BackupRepository["saveSettings"]>[0], actor: User) { return this.repository.saveSettings(input, actor); }

  async requestBackup(type: BackupType, actor: User) {
    const id = `${new Date().toISOString().replace(/[-:.]/g, "").replace("Z", "Z")}-${randomUUID().slice(0, 8)}`;
    const backup = await this.repository.request(id, type, actor);
    this.logger.log(JSON.stringify({ event: "BACKUP_REQUESTED", backupId: id, type, provider: this.storage.provider }));
    return { ...present(backup), execution: { job: "CreateBackupJob", cli: `./scripts/backup.sh ${type.toLowerCase()} --backup-id ${id}` } };
  }

  async verifyBackup(id: string) {
    const backup = await this.repository.get(id);
    if (!backup) throw new NotFoundException("Резервная копия не найдена");
    if (!(await this.storage.exists(id))) throw new BadRequestException("Файлы резервной копии отсутствуют");
    const verified = await this.storage.verify(id);
    this.logger.log(JSON.stringify({ event: "BACKUP_VERIFIED", backupId: id, provider: this.storage.provider, sizeBytes: verified.sizeBytes.toString() }));
    return { ...verified, sizeBytes: verified.sizeBytes.toString() };
  }

  async applyRetentionPolicy(execute = false) {
    const settings = await this.repository.settings();
    const candidates = await this.repository.retentionCandidates(settings.retentionCount);
    if (execute) for (const backup of candidates) { await this.storage.remove(backup.id); await this.repository.archive(backup.id); }
    return { keep: settings.retentionCount, candidates: candidates.map(item => item.id), executed: execute };
  }
}
