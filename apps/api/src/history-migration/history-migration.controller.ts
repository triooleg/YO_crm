import { Body, Controller, Get, Header, Param, Post, Req, UseGuards, BadRequestException, applyDecorators } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { CreateHistoryJobDto, HistoryPasswordDto, StageHistoryPacketDto } from './history-migration.dto';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SessionGuard } from '../auth/session.guard';
import { HistoryMigrationService } from './history-migration.service';

const PrivateResponse = () => applyDecorators(Header('Cache-Control', 'no-store'), Header('Referrer-Policy', 'no-referrer'));
type OwnerRequest = Request & { user: User };
@Controller('admin/history-migration')
@UseGuards(SessionGuard, RolesGuard)
@Roles('OWNER')
export class HistoryMigrationController {
  constructor(private readonly migration: HistoryMigrationService) {}
  @PrivateResponse()
  @Get('jobs') list(@Req() req: OwnerRequest) { return this.migration.list(req.user, req.query); }
  @PrivateResponse()
  @Get('jobs/:jobId') detail(@Param('jobId') id: string, @Req() req: OwnerRequest) { return this.migration.ownerDetail(id, req.user); }
  @PrivateResponse()
  @Post('jobs') create(@Body() body: CreateHistoryJobDto, @Req() req: OwnerRequest) { return this.migration.create(body, body.currentPassword, req.user); }
  @PrivateResponse()
  @Post('jobs/:jobId/pair') pair(@Param('jobId') id: string, @Body() body: HistoryPasswordDto, @Req() req: OwnerRequest) { return this.migration.pair(id, body.currentPassword, req.user); }
  @PrivateResponse()
  @Post('jobs/:jobId/revoke') revoke(@Param('jobId') id: string, @Body() body: HistoryPasswordDto, @Req() req: OwnerRequest) { return this.migration.revoke(id, body.currentPassword, req.user); }
  @PrivateResponse()
  @Post('jobs/:jobId/close') close(@Param('jobId') id: string, @Body() body: HistoryPasswordDto, @Req() req: OwnerRequest) { return this.migration.revoke(id, body.currentPassword, req.user, true); }
  @PrivateResponse()
  @Get('jobs/:jobId/preview') preview(@Param('jobId') id: string, @Req() req: OwnerRequest) { return this.migration.preview(id, req.user); }
}
/** Deliberately no session guard: a job-scoped bearer grants staging only, never CRM reads. */
@Controller('history-migration-agent/jobs')
export class HistoryMigrationAgentController {
  constructor(private readonly migration: HistoryMigrationService) {}
  private bearer(req: Request) {
    if (Object.keys(req.query).length) throw new BadRequestException('Параметры URL не поддерживаются');
    return req.headers.authorization;
  }
  @PrivateResponse()
  @Get(':jobId') status(@Param('jobId') id: string, @Req() req: Request) { return this.migration.status(id, this.bearer(req)); }
  @PrivateResponse()
  @Post(':jobId/batches') stage(@Param('jobId') id: string, @Body() body: StageHistoryPacketDto, @Req() req: Request) { return this.migration.stage(id, this.bearer(req), body); }
}
