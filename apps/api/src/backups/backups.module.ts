import { Module } from "@nestjs/common";
import { PrismaService } from "../prisma.service";
import { BACKUP_STORAGE, LocalBackupStorage } from "./backup.storage";
import { BackupRepository } from "./backup.repository";
import { BackupService } from "./backup.service";
import { RestoreService } from "./restore.service";
import { BackupsController } from "./backups.controller";
import { BackupScheduler } from "./backup.scheduler";

@Module({
  controllers: [BackupsController],
  providers: [PrismaService, BackupRepository, BackupService, RestoreService, BackupScheduler, LocalBackupStorage, { provide: BACKUP_STORAGE, useExisting: LocalBackupStorage }],
  exports: [BackupService, RestoreService],
})
export class BackupsModule {}
