import { Body, Controller, Get, Param, Put, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import type { User } from "@prisma/client";
import { join } from "node:path";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { uploadsRoot } from "../uploads";
import { BrandingService, BRANDING_FILE_NAME } from "./branding.service";
import { UpdateBrandingDto } from "./branding.dto";

@Controller("branding")
@UseGuards(SessionGuard, RolesGuard)
export class BrandingController {
  constructor(private readonly branding: BrandingService) {}
  @Get() @Roles("OWNER", "ADMIN", "MANAGER", "PRODUCTION", "ACCOUNTANT") settings() { return this.branding.settings(); }
  @Put() @Roles("OWNER", "ADMIN") update(@Body() dto: UpdateBrandingDto, @Req() req: Request & { user: User }) { return this.branding.update(dto, req.user); }
  @Get("logo/:name") @Roles("OWNER", "ADMIN", "MANAGER", "PRODUCTION", "ACCOUNTANT") logo(@Param("name") name: string, @Res() res: Response) {
    if (!BRANDING_FILE_NAME.test(name)) return res.status(404).end();
    return res.sendFile(join(uploadsRoot(), "branding", name));
  }
}
