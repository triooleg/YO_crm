import { Module } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { PrismaService } from "../prisma.service";
import { BACKUP_STORAGE, LocalBackupStorage } from "./backup.storage";
import { BackupRepository } from "./backup.repository";
import { BackupService } from "./backup.service";
import { RestoreService } from "./restore.service";
import { BackupsController } from "./backups.controller";
import { BackupScheduler } from "./backup.scheduler";

@Module({
  controllers: [BackupsController],
  providers: [PrismaService, AuthService, SessionGuard, RolesGuard, BackupRepository, BackupService, RestoreService, BackupScheduler, LocalBackupStorage, { provide: BACKUP_STORAGE, useExisting: LocalBackupStorage }],
  exports: [BackupService, RestoreService],
})
export class BackupsModule {}
