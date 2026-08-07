import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole, type User } from "@prisma/client";
import type { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { CreateAthleteDto, CreateClientDto, CreateMeasurementDto } from "./clients.dto";
import { ClientsService } from "./clients.service";

type AuthRequest = Request & { user: User };

@Controller("clients")
@UseGuards(SessionGuard, RolesGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@Query("search") search?: string) {
    return this.clients.list(search);
  }

  @Get(":id")
  detail(@Param("id") id: string) {
    return this.clients.detail(id);
  }

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreateClientDto, @Req() request: AuthRequest) {
    return this.clients.create(dto, request.user);
  }

  @Post(":id/athletes")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  addAthlete(@Param("id") id: string, @Body() dto: CreateAthleteDto, @Req() request: AuthRequest) {
    return this.clients.addAthlete(id, dto, request.user);
  }

  @Post(":id/athletes/:athleteId/measurements")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.PRODUCTION)
  addMeasurement(@Param("id") id: string, @Param("athleteId") athleteId: string, @Body() dto: CreateMeasurementDto, @Req() request: AuthRequest) {
    return this.clients.addMeasurement(id, athleteId, dto, request.user);
  }
}
