import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { UserRole, type User } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SessionGuard } from '../auth/session.guard';
import { ArchiveOrderAthleteDto, ArchiveOrderMeasurementDto, AssignOrderMeasurementsDto, CreateOrderAthleteDto, CreateOrderSnapshotDto, MeasurementUsageQueryDto } from './order-measurement-assignments.dto';
import { OrderMeasurementAssignmentsService } from './order-measurement-assignments.service';

@Controller('order-tabs')
@UseGuards(SessionGuard, RolesGuard)
@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)
export class OrderMeasurementAssignmentsController {
  constructor(private readonly assignments: OrderMeasurementAssignmentsService) {}

  @Post(':orderId/athletes')
  createAthlete(@Param('orderId') orderId:string,@Body() dto:CreateOrderAthleteDto,@Req() req:Request&{user:User}){return this.assignments.createAthlete(orderId,dto,req.user);}

  @Post(':orderId/athletes/:athleteId/measurements')
  createSnapshot(@Param('orderId') orderId:string,@Param('athleteId') athleteId:string,@Body() dto:CreateOrderSnapshotDto,@Req() req:Request&{user:User}){return this.assignments.createSnapshot(orderId,athleteId,dto,req.user);}

  @Post(':orderId/instances/assign')
  assign(@Param('orderId') orderId: string, @Body() input: AssignOrderMeasurementsDto, @Req() req: Request & { user: User }) {
    return this.assignments.assign(orderId, input, req.user);
  }

  @Get(':orderId/measurements/usage')
  usage(@Param('orderId') orderId: string, @Query() query: MeasurementUsageQueryDto) {
    return this.assignments.usage(orderId, query);
  }

  @Get(':orderId/instances/:instanceId/history')
  history(@Param('orderId') orderId:string,@Param('instanceId') instanceId:string){return this.assignments.history(orderId,instanceId);}

  @Post(':orderId/measurements/:measurementId/archive')
  archiveMeasurement(@Param('orderId') orderId: string, @Param('measurementId') measurementId: string, @Body() input: ArchiveOrderMeasurementDto, @Req() req: Request & { user: User }) {
    return this.assignments.archiveMeasurement(orderId, measurementId, input, req.user);
  }

  @Post(':orderId/athletes/:athleteId/archive')
  archiveAthlete(@Param('orderId') orderId: string, @Param('athleteId') athleteId: string, @Body() input: ArchiveOrderAthleteDto, @Req() req: Request & { user: User }) {
    return this.assignments.archiveAthlete(orderId, athleteId, input, req.user);
  }
}
