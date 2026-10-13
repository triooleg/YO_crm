import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { UserRole, type User } from "@prisma/client";
import type { Request } from "express";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { CreateAthleteDto, CreateClientDto, CreateMeasurementDto, MergeClientDto, PromoteInboxClientDto, SplitClientDto, UpdateAthleteDto, UpdateClientNotesDto, UpdateClientProfileDto } from "./clients.dto";
import { ClientsService } from "./clients.service";

type AuthRequest = Request & { user: User };

@Controller("clients")
@UseGuards(SessionGuard, RolesGuard)
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  list(@Query("search") search?: string) {
    return this.clients.list(search);
  }

  @Get(":id")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  detail(@Param("id") id: string, @Query("orderId") orderId?: string) {
    return this.clients.detail(id, orderId);
  }

  @Get(":id/merge-suggestions")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  mergeSuggestions(@Param("id") id:string){return this.clients.mergeSuggestions(id)}

  @Post(":id/merge")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  merge(@Param("id") id:string,@Body()dto:MergeClientDto,@Req()request:AuthRequest){return this.clients.merge(id,dto.sourceClientId,request.user)}

  @Post(":id/split")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  split(@Param("id") id:string,@Body()dto:SplitClientDto,@Req()request:AuthRequest){return this.clients.split(id,dto.sourceClientId,request.user)}

  @Post()
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  create(@Body() dto: CreateClientDto, @Req() request: AuthRequest) {
    return this.clients.create(dto, request.user);
  }

  @Post(":id/promote-from-inbox")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  promoteFromInbox(@Param("id") id:string,@Body()dto:PromoteInboxClientDto,@Req()request:AuthRequest){return this.clients.promoteFromInbox(id,dto,request.user)}

  @Patch(":id/notes")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  updateNotes(@Param("id") id:string,@Body()dto:UpdateClientNotesDto,@Req()request:AuthRequest){return this.clients.updateNotes(id,dto.notes,request.user)}

  @Patch(":id")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  updateProfile(@Param("id") id:string,@Body()dto:UpdateClientProfileDto,@Req()request:AuthRequest){return this.clients.updateProfile(id,dto,request.user)}

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

  @Patch(":id/athletes/:athleteId")
  @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
  updateAthlete(@Param("id") id: string, @Param("athleteId") athleteId: string, @Body() dto: UpdateAthleteDto, @Req() request: AuthRequest) {
    return this.clients.updateAthlete(id, athleteId, dto, request.user);
  }
}
