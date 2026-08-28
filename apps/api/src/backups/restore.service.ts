import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { BackupStatus, type User } from "@prisma/client";
import { PrismaService } from "../prisma.service";
import { BackupService } from "./backup.service";

@Injectable()
export class RestoreService {
  private readonly logger = new Logger(RestoreService.name);
  constructor(private readonly prisma: PrismaService, private readonly backups: BackupService) {}

  async requestRestore(id: string, confirmation: string, actor: User) {
    if (process.env.ALLOW_RESTORE !== "true") throw new BadRequestException("Восстановление отключено настройкой ALLOW_RESTORE");
    if (process.env.NODE_ENV === "production") throw new BadRequestException("Восстановление через API запрещено в production; используйте проверенный аварийный регламент");
    if (confirmation !== id) throw new BadRequestException("Подтвердите точный идентификатор резервной копии");
    const backup = await this.prisma.backup.findFirst({ where: { id, archivedAt: null } });
    if (!backup) throw new NotFoundException("Резервная копия не найдена");
    if (backup.status !== BackupStatus.COMPLETED) throw new BadRequestException("Восстанавливать можно только завершённую резервную копию");
    await this.backups.verifyBackup(id);
    await this.prisma.auditLog.create({ data: { actorId: actor.id, action: "RESTORE_REQUESTED", entityType: "Backup", entityId: id, after: { environment: process.env.NODE_ENV || "development", verified: true } } });
    this.logger.warn(JSON.stringify({ event: "RESTORE_REQUESTED", backupId: id, environment: process.env.NODE_ENV || "development", execution: "CLI_REQUIRED" }));
    return { id, verified: true, execution: "CLI_REQUIRED", command: `./scripts/restore.sh --backup-id ${id}` };
  }
}
