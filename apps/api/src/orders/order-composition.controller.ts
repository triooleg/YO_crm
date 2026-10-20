import { Body, Controller, Param, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole,type User } from '@prisma/client';
import type {Request} from 'express';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { OrderCompositionService } from './order-composition.service';
import { ApplyOrderCompositionDto,OrderCompositionCommandDto } from './order-composition.dto';
import {ApplyOrderDiscountDto,OrderDiscountCommandDto} from './order-discount.dto';
@Controller('orders/:orderId/composition')
@UseGuards(SessionGuard,RolesGuard)
export class OrderCompositionController {
  constructor(private readonly composition:OrderCompositionService){}
  @Post('discount/preview') @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER)
  discountPreview(@Param('orderId') orderId:string,@Body() dto:OrderDiscountCommandDto){return this.composition.discountPreview(orderId,dto);}
  @Post('discount/apply') @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER)
  discountApply(@Param('orderId') orderId:string,@Body() dto:ApplyOrderDiscountDto,@Req() req:Request&{user:User}){return this.composition.discountApply(orderId,dto,req.user);}
  @Post('preview') @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER)
  preview(@Param('orderId') orderId:string,@Body() dto:OrderCompositionCommandDto){return this.composition.preview(orderId,dto);}
  @Post('apply') @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER)
  apply(@Param('orderId') orderId:string,@Body() dto:ApplyOrderCompositionDto,@Req() req:Request&{user:User}){return this.composition.apply(orderId,dto,req.user);}
}
