import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { CreateBackupDto, BackupSettingsDto, RestoreBackupDto } from "./backup.dto";
import { BackupService } from "./backup.service";
import { RestoreService } from "./restore.service";

@Controller("admin/backups")
@UseGuards(SessionGuard, RolesGuard)
@Roles("OWNER","ADMIN")
export class BackupsController {
  constructor(private readonly backups: BackupService, private readonly restore: RestoreService) {}
  @Get() list() { return this.backups.listBackups(); }
  @Post() create(@Body() dto: CreateBackupDto, @Req() request: Request & { user: User }) { return this.backups.requestBackup(dto.type, request.user); }
  @Get("settings") settings() { return this.backups.settings(); }
  @Put("settings") saveSettings(@Body() dto: BackupSettingsDto, @Req() request: Request & { user: User }) { return this.backups.saveSettings(dto, request.user); }
  @Get(":id") get(@Param("id") id: string) { return this.backups.getBackup(id); }
  @Post(":id/verify") verify(@Param("id") id: string) { return this.backups.verifyBackup(id); }
  @Post(":id/restore") restoreBackup(@Param("id") id: string, @Body() dto: RestoreBackupDto, @Req() request: Request & { user: User }) { return this.restore.requestRestore(id, dto.confirmBackupId, request.user); }
}
