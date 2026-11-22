import { BadRequestException, Body, Controller, Delete, Get, Header, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { WebPushService } from './web-push.service';

type AuthRequest = Request & { user: User };

@Controller('web-push')
@UseGuards(SessionGuard, RolesGuard)
export class WebPushController {
  constructor(private readonly push: WebPushService) {}

  @Get('config')
  @Header('Cache-Control', 'no-store')
  config(@Req() req: AuthRequest) {
    return this.push.config(req.user, req.cookies?.yoleotard_crm_session);
  }

  @Post('subscriptions/current')
  @Header('Cache-Control', 'no-store')
  current(@Req() req: AuthRequest, @Body() input: unknown) {
    const endpoint = input && typeof input === 'object' ? (input as {endpoint?: unknown}).endpoint : undefined;
    if (typeof endpoint !== 'string') throw new BadRequestException('Некорректная подписка уведомлений');
    return this.push.config(req.user, req.cookies?.yoleotard_crm_session, endpoint);
  }

  @Put('subscriptions')
  @Roles('OWNER', 'ADMIN', 'MANAGER')
  subscribe(@Req() req: AuthRequest, @Body() input: unknown) {
    return this.push.subscribe(req.user, req.cookies?.yoleotard_crm_session, input);
  }

  @Delete('subscriptions')
  unsubscribe(@Req() req: AuthRequest, @Body() input: unknown) {
    return this.push.unsubscribe(req.user, req.cookies?.yoleotard_crm_session, input);
  }
}
