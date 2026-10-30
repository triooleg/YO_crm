import { Module } from "@nestjs/common";
import { AuthService } from "../auth/auth.service";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { PrismaModule } from "../prisma.module";
import { BACKUP_STORAGE, LocalBackupStorage } from "./backup.storage";
import { BackupRepository } from "./backup.repository";
import { BackupService } from "./backup.service";
import { RestoreService } from "./restore.service";
import { BackupsController } from "./backups.controller";
import { BackupScheduler } from "./backup.scheduler";
import { ComputerTransferController, BackupSyncController } from "./computer-transfer.controller";
import { ComputerTransferStore } from "./computer-transfer.store";
import { ComputerTransferService } from "./computer-transfer.service";
import { BackupSyncGuard } from "./backup-sync.guard";

@Module({
  imports: [PrismaModule],
  // Static management routes must precede the established :id backup route.
  controllers: [ComputerTransferController, BackupSyncController, BackupsController],
  providers: [AuthService, SessionGuard, RolesGuard, ComputerTransferStore, ComputerTransferService, BackupSyncGuard, BackupRepository, BackupService, RestoreService, BackupScheduler, LocalBackupStorage, { provide: BACKUP_STORAGE, useExisting: LocalBackupStorage }],
  exports: [BackupService, RestoreService],
})
export class BackupsModule {}
