import { Body, Controller, Get, Header, Param, Post, Req, UseGuards, applyDecorators } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { BindHistoryTargetDto, ResolveHistoryTargetDto } from './history-migration.dto';
import { HistoryMigrationPlanningService } from './history-planning.service';

const PrivateResponse = () => applyDecorators(Header('Cache-Control', 'no-store'), Header('Referrer-Policy', 'no-referrer'));
type OwnerRequest = Request & { user: User };
@Controller('admin/history-migration/jobs')
@UseGuards(SessionGuard, RolesGuard)
@Roles('OWNER')
export class HistoryMigrationPlanningController {
  constructor(private readonly planning: HistoryMigrationPlanningService) {}
  @Post(':jobId/targets/resolve') @PrivateResponse()
  resolve(@Param('jobId') id: string, @Body() input: ResolveHistoryTargetDto, @Req() req: OwnerRequest) { return this.planning.resolve(id, input, req.user); }
  @Post(':jobId/targets') @PrivateResponse()
  bind(@Param('jobId') id: string, @Body() input: BindHistoryTargetDto, @Req() req: OwnerRequest) { return this.planning.bind(id, input, input.currentPassword, req.user); }
  @Get(':jobId/dry-run') @PrivateResponse()
  preview(@Param('jobId') id: string, @Req() req: OwnerRequest) { return this.planning.dryRun(id, req.user); }
}
