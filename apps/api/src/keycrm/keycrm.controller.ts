import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole, type User } from "@prisma/client";
import type { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { CreateKeycrmSyncRunDto, UpdateKeycrmSettingsDto } from "./keycrm.dto";
import { KeycrmService } from "./keycrm.service";

@Controller("keycrm")
@UseGuards(SessionGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN)
export class KeycrmController {
  constructor(private readonly keycrm: KeycrmService) {}

  @Get("settings")
  settings() { return this.keycrm.settings(); }

  @Patch("settings")
  saveSettings(@Body() dto: UpdateKeycrmSettingsDto, @Req() req: Request & { user: User }) { return this.keycrm.saveSettings(dto, req.user); }

  @Post("test-connection")
  testConnection(@Req() req: Request & { user: User }) { return this.keycrm.testConnection(req.user); }

  @Post("sync-runs")
  createRun(@Body() dto: CreateKeycrmSyncRunDto, @Req() req: Request & { user: User }) { return this.keycrm.createRun(dto, req.user); }

  @Get("sync-runs")
  runs(@Query("limit") limit?: string) { return this.keycrm.runs(limit); }

  @Get("sync-runs/:id")
  run(@Param("id") id: string) { return this.keycrm.run(id); }

  @Get("sync-runs/:id/issues")
  issues(@Param("id") id: string) { return this.keycrm.issues(id); }

}
