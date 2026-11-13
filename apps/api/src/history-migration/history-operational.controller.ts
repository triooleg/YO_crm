import { BadRequestException, Body, Controller, Get, Header, Param, Post, Req, UseGuards, applyDecorators } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { ApplyOperationalHistoryDto, HistoryPasswordDto } from './history-migration.dto';
import { HistoryOperationalActionsService } from './history-operational-actions.service';

const PrivateResponse = () => applyDecorators(Header('Cache-Control','no-store'),Header('Referrer-Policy','no-referrer'));
type OwnerRequest = Request & {user: User};
type Preview = Awaited<ReturnType<HistoryOperationalActionsService['preview']>>;
const publicPreview = (plan: Preview) => ({jobId: plan.jobId, clientId: plan.clientId, sourceDigest: plan.sourceDigest,
  previewDigest: plan.previewDigest, equivalenceCount: plan.equivalenceCount, preview: plan.preview});

@Controller('admin/history-migration/jobs/:jobId/operational')
@UseGuards(SessionGuard,RolesGuard)
@Roles('OWNER')
export class HistoryOperationalController {
  constructor(private readonly actions: HistoryOperationalActionsService) {}
  @Post('preview') @PrivateResponse()
  async preview(@Param('jobId') id: string, @Body() body: unknown, @Req() req: OwnerRequest) {
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length) throw new BadRequestException('Предпросмотр не принимает дополнительные параметры');
    return publicPreview(await this.actions.preview(id,req.user));
  }
  @Post('prepare') @PrivateResponse()
  async prepare(@Param('jobId') id: string, @Body() body: HistoryPasswordDto, @Req() req: OwnerRequest) {
    return publicPreview(await this.actions.prepare(id,body.currentPassword,req.user));
  }
  @Get('status') @PrivateResponse()
  status(@Param('jobId') id: string, @Req() req: OwnerRequest) { return this.actions.status(id,req.user); }
  @Post('apply') @PrivateResponse()
  apply(@Param('jobId') id: string, @Body() body: ApplyOperationalHistoryDto, @Req() req: OwnerRequest) {
    return this.actions.apply(id,body.previewDigest,body.currentPassword,req.user);
  }
  @Post('runs/:runId/rollback') @PrivateResponse()
  rollback(@Param('jobId') id: string, @Param('runId') runId: string, @Body() body: HistoryPasswordDto, @Req() req: OwnerRequest) {
    return this.actions.rollback(id,runId,body.currentPassword,req.user);
  }
}
