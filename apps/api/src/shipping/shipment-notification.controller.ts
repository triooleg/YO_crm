import { Body, Controller, Delete, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SessionGuard } from '../auth/session.guard';
import { ShipmentNotificationService } from './shipment-notification.service';
import { ShipmentNotificationPreviewDto, ShipmentNotificationScopeDto, ShipmentNotificationSendDto, ShipmentTrackingUrlDto } from './shipment-notification.dto';

@Controller('shipment-notifications')
@UseGuards(SessionGuard, RolesGuard)
@Roles('OWNER','ADMIN','MANAGER')
export class ShipmentNotificationController {
  constructor(private readonly notifications: ShipmentNotificationService) {}
  @Get('options') options(@Query() scope: ShipmentNotificationScopeDto, @Req() req: Request & {user:User}) { return this.notifications.options(scope,req.user); }
  @Post('preview') preview(@Body() input: ShipmentNotificationPreviewDto, @Req() req: Request & {user:User}) { return this.notifications.preview(input,req.user); }
  @Post('send') send(@Body() input: ShipmentNotificationSendDto, @Req() req: Request & {user:User}) { return this.notifications.send(input,req.user); }
  @Put('tracking-url') @Roles('OWNER','ADMIN') trackingUrl(@Body() input: ShipmentTrackingUrlDto,@Req() req: Request & {user:User}) { return this.notifications.saveTrackingUrl(input,req.user); }
  @Get('tracking-url') @Roles('OWNER','ADMIN','MANAGER') trackingOptions(@Query('orderId') orderId:string,@Query('shipmentId') shipmentId:string) { return this.notifications.trackingOptions(orderId,shipmentId); }
  @Delete('tracking-url') @Roles('OWNER','ADMIN') clearTracking(@Body() input:ShipmentTrackingUrlDto,@Req() req:Request & {user:User}) { return this.notifications.clearTracking(input,req.user); }
  @Get(':id') status(@Param('id') id:string,@Req() req: Request & {user:User}) { return this.notifications.status(id,req.user); }
}
