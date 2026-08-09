import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { join } from "node:path";
import type { User } from "@prisma/client";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { uploadsRoot } from "../uploads";
import { AddOrderPaymentDto, CreateOrderDto, UpdateOrderStatusesDto, UpdateProductionSlotDto, UploadModelImageDto } from "./orders.dto";
import { OrdersService } from "./orders.service";

@Controller("orders")
@UseGuards(SessionGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get() list(@Query("search") search?: string) { return this.orders.list(search); }
  @Post("model-image") @Roles("OWNER", "ADMIN", "MANAGER") upload(@Body() dto: UploadModelImageDto) { return this.orders.upload(dto); }
  @Post() @Roles("OWNER", "ADMIN", "MANAGER") create(@Body() dto: CreateOrderDto, @Req() req: Request & { user: User }) { return this.orders.create(dto, req.user); }
  @Patch(":id/statuses") @Roles("OWNER", "ADMIN", "MANAGER") updateStatuses(@Param("id") id: string, @Body() dto: UpdateOrderStatusesDto, @Req() req: Request & { user: User }) { return this.orders.updateStatuses(id, dto, req.user); }
  @Patch(":id/production-slot") @Roles("OWNER", "ADMIN", "MANAGER") updateProductionSlot(@Param("id") id: string, @Body() dto: UpdateProductionSlotDto, @Req() req: Request & { user: User }) { return this.orders.updateProductionSlot(id, dto, req.user); }
  @Post(":id/payments") @Roles("OWNER", "ADMIN", "MANAGER") addPayment(@Param("id") id: string, @Body() dto: AddOrderPaymentDto, @Req() req: Request & { user: User }) { return this.orders.addPayment(id, dto, req.user); }
  @Get("images/:name") image(@Param("name") name: string, @Res() res: Response) {
    if (!/^[a-f0-9-]+\.(jpg|png|webp)$/.test(name)) return res.status(404).end();
    return res.sendFile(join(uploadsRoot(), "order-models", name));
  }
}
