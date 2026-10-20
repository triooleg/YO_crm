import { Controller, Get, Header, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import type { User } from '@prisma/client';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OverviewService } from './overview.service';
import { OverviewOrdersQueryDto } from './overview.dto';

@Controller('overview')
@UseGuards(SessionGuard,RolesGuard)
export class OverviewController {
  constructor(private readonly overview:OverviewService) {}
  @Get('orders') @Header('Cache-Control','no-store') @Roles('OWNER','ADMIN','MANAGER')
  orders(@Query() query:OverviewOrdersQueryDto){return this.overview.orders(query);}
  @Get('tasks') @Header('Cache-Control','no-store') @Roles('OWNER','ADMIN','MANAGER','PRODUCTION')
  tasks(@Req() request:Request&{user:User}){return this.overview.tasks(request.user.id);}
  @Get('messages') @Header('Cache-Control','no-store') @Roles('OWNER','ADMIN','MANAGER')
  messages(){return this.overview.messages();}
  @Get('shipments') @Header('Cache-Control','no-store') @Roles('OWNER','ADMIN','MANAGER')
  shipments(){return this.overview.shipments();}
}
