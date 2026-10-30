import { Body, Controller, Get, Header, Param, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { User } from "@prisma/client";
import type { Request } from "express";
import { IsIn, IsInt, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { BackupSyncGuard, type BackupSyncRequest } from "./backup-sync.guard";
import { ComputerTransferService } from "./computer-transfer.service";

class ComputerPasswordDto { @IsString() @MinLength(1) @MaxLength(1024) currentPassword!: string; }
class ComputerTransferDto extends ComputerPasswordDto {
  @IsIn(["MANUAL", "AUTOMATIC"]) mode!: "MANUAL" | "AUTOMATIC";
  @IsString() @MinLength(4) @MaxLength(240) folder!: string;
  @IsInt() @Min(5) @Max(1440) intervalMinutes!: number;
}
class PairComputerDto extends ComputerPasswordDto { @IsString() @MinLength(1) @MaxLength(120) name!: string; }
@Controller("admin/backups")
@UseGuards(SessionGuard, RolesGuard)
@Roles("OWNER", "ADMIN")
export class ComputerTransferController {
  constructor(private readonly transfers: ComputerTransferService) {}
  @Get("computer-transfer") @Header("Cache-Control", "no-store")
  config(@Req() request: Request & { user: User }) { return this.transfers.config(request.user); }
  @Put("computer-transfer") @Header("Cache-Control", "no-store")
  save(@Body() dto: ComputerTransferDto, @Req() request: Request & { user: User }) { return this.transfers.saveConfig(dto, request.user); }
  @Get("computers") @Header("Cache-Control", "no-store")
  devices(@Req() request: Request & { user: User }) { return this.transfers.devices(request.user); }
  @Post("computers") @Header("Cache-Control", "no-store") @Header("Referrer-Policy", "no-referrer")
  issue(@Body() dto: PairComputerDto, @Req() request: Request & { user: User }) { return this.transfers.issue(dto.name, dto.currentPassword, request.user); }
  @Post("computers/:deviceId/revoke") @Header("Cache-Control", "no-store")
  revoke(@Param("deviceId") id: string, @Body() dto: ComputerPasswordDto, @Req() request: Request & { user: User }) { return this.transfers.revoke(id, dto.currentPassword, request.user); }
}
@Controller("backup-sync")
@UseGuards(BackupSyncGuard)
export class BackupSyncController {
  constructor(private readonly transfers: ComputerTransferService) {}
  @Get("archives")
  archives(@Req() request: BackupSyncRequest, @Query("cursor") cursor?: string, @Query("limit") limit?: string) {
    return this.transfers.archives(request.backupDevice, cursor, limit);
  }
  @Get("archives/:id/download")
  download(@Param("id") id: string, @Req() request: BackupSyncRequest) { return this.transfers.download(id, request.backupDevice); }
}
