import { Injectable } from "@nestjs/common";
import { BackupStatus, BackupType, Prisma, type User } from "@prisma/client";
import { PrismaService } from "../prisma.service";

@Injectable()
export class BackupRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.backup.findMany({ where: { archivedAt: null }, orderBy: { createdAt: "desc" }, take: 100 });
  }

  get(id: string) {
    return this.prisma.backup.findFirst({ where: { id, archivedAt: null } });
  }

  request(id: string, type: BackupType, actor: User) {
    return this.prisma.$transaction(async tx => {
      const backup = await tx.backup.create({ data: { id, type, status: BackupStatus.PENDING, createdById: actor.id, metadata: { job: "CreateBackupJob", requestedVia: "API" } } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "BACKUP_REQUESTED", entityType: "Backup", entityId: id, after: { type, status: backup.status } } });
      return backup;
    });
  }

  async saveSettings(input: { enabled: boolean; frequency: string; time: string; timezone: string; backupType: BackupType; retentionCount: number }, actor: User) {
    return this.prisma.$transaction(async tx => {
      const before = await tx.backupSetting.findUnique({ where: { id: "default" } });
      const setting = await tx.backupSetting.upsert({ where: { id: "default" }, create: { id: "default", ...input }, update: input });
      const auditView = (value: typeof setting | null) => value ? { enabled: value.enabled, frequency: value.frequency, time: value.time, timezone: value.timezone, backupType: value.backupType, retentionCount: value.retentionCount, storageProvider: value.storageProvider } : undefined;
      await tx.auditLog.create({ data: { actorId: actor.id, action: before ? "BACKUP_SETTINGS_UPDATED" : "BACKUP_SETTINGS_CREATED", entityType: "BackupSetting", entityId: setting.id, before: auditView(before) as Prisma.InputJsonValue | undefined, after: auditView(setting) as Prisma.InputJsonValue } });
      return setting;
    });
  }

  settings() {
    return this.prisma.backupSetting.upsert({ where: { id: "default" }, create: { id: "default" }, update: {} });
  }

  retentionCandidates(keep: number) {
    return this.prisma.backup.findMany({ where: { archivedAt: null, status: BackupStatus.COMPLETED }, orderBy: { createdAt: "desc" }, skip: keep });
  }

  archive(id: string) {
    return this.prisma.backup.update({ where: { id }, data: { archivedAt: new Date() } });
  }
}
