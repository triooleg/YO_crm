import { BadRequestException, Body, Controller, Get, Header, Param, Post, Put, Query, Req, UploadedFile, UseGuards, UseInterceptors } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { CreateBackupDto, BackupSettingsDto, RestoreBackupDto, BackupPasswordDto, BackupDrillDto, BackupRecoveryPlanDto, BackupUploadDto } from "./backup.dto";
import { BackupService } from "./backup.service";
import { RestoreService } from "./restore.service";
import { BackupUploadInterceptor, type QuarantinedArchive } from "./backup.upload";
@Controller("admin/backups")
@UseGuards(SessionGuard, RolesGuard)
@Roles("OWNER","ADMIN")
export class BackupsController {
  constructor(private readonly backups: BackupService, private readonly restore: RestoreService) {}
  @Get() list() { return this.backups.listBackups(); }
  @Post() create(@Body() dto: CreateBackupDto, @Req() request: Request & { user: User }) { return this.backups.requestBackup(dto.type, request.user, dto.idempotencyKey); }
  @Get("settings") settings() { return this.backups.settings(); }
  @Put("settings") saveSettings(@Body() dto: BackupSettingsDto, @Req() request: Request & { user: User }) { return this.backups.saveSettings(dto, request.user); }
  @Get("overview") overview() { return this.backups.overview(); }
  @Get("journal") journal(@Query("limit") limit?: string) { return this.backups.journal(limit === undefined ? 50 : Number(limit)); }
  @Post("upload") @UseInterceptors(BackupUploadInterceptor)
  upload(@UploadedFile() file: QuarantinedArchive | undefined, @Body() dto: BackupUploadDto, @Req() request: Request & { user: User }) {
    if (!file) throw new BadRequestException("Добавьте файл archive");
    return this.backups.importArchive(file, dto.type, request.user);
  }
  @Get(":id") get(@Param("id") id: string) { return this.backups.getBackup(id); }
  @Post(":id/verify") verify(@Param("id") id: string, @Req() request: Request & { user: User }) { return this.backups.verifyBackup(id, request.user); }
  @Post(":id/download") @Header("Cache-Control", "no-store") @Header("X-Content-Type-Options", "nosniff")
  download(@Param("id") id: string, @Body() dto: BackupPasswordDto, @Req() request: Request & { user: User }) { return this.backups.download(id, dto.currentPassword, request.user); }
  @Post(":id/drill") drill(@Param("id") id: string, @Body() dto: BackupDrillDto, @Req() request: Request & { user: User }) { return this.backups.requestDrill(id, dto.currentPassword, request.user, dto.idempotencyKey); }
  @Post(":id/recovery-plan") recoveryPlan(@Param("id") id: string, @Body() dto: BackupRecoveryPlanDto, @Req() request: Request & { user: User }) { return this.backups.recoveryPlan(id, dto.currentPassword, dto.confirmBackupId, request.user); }
  @Post(":id/restore") restoreBackup(@Param("id") id: string, @Body() dto: RestoreBackupDto, @Req() request: Request & { user: User }) { return this.restore.requestRestore(id, dto.confirmBackupId, request.user); }
}
