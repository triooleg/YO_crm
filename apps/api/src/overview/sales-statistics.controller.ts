import { Controller, Get, Header, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { SalesStatisticsService } from './sales-statistics.service';
import { SalesStatisticsQueryDto } from './sales-statistics.dto';

@Controller('overview/sales-statistics')
@UseGuards(SessionGuard, RolesGuard)
@Roles('OWNER', 'ADMIN', 'MANAGER', 'ACCOUNTANT')
export class SalesStatisticsController {
  constructor(private readonly statistics: SalesStatisticsService) {}
  @Get() @Header('Cache-Control', 'no-store')
  report(@Query() query: SalesStatisticsQueryDto, @Req() request: Request & { user: User }) {
    return this.statistics.report(query, request.user);
  }
  @Get('export') @Header('Cache-Control', 'no-store')
  export(@Query() query: SalesStatisticsQueryDto, @Req() request: Request & { user: User }, @Res() response: Response) {
    const csv = this.statistics.export(query, request.user);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', 'attachment; filename="sales-statistics.csv"');
    return response.send(csv);
  }
}
