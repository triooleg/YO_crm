import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { join } from "node:path";
import { UserRole, type User } from "@prisma/client";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { uploadsRoot } from "../uploads";
import { AddOrderItemDto, AddOrderPaymentDto, ArchiveOrdersDto, BindOrderItemMeasurementDto, CreateOrderDto, DeleteProductionSlotDto, OrderMeasurementDto, UpdateOrderBuyerCommentDto, UpdateOrderCurrencyDto, UpdateOrderDeadlineDto, UpdateOrderDeliveryAddressDto, UpdateOrderDeliveryContactDto, UpdateOrderDetailsDto, UpdateOrderDisciplineDto, UpdateOrderItemDetailsDto, UpdateOrderModelImageDto, UpdateOrderStatusesDto, UpdateProductionSlotDto, UploadModelImageDto, UploadOrderFileDto, WebsiteSalesCorrectionDto, VoidOrderPaymentDto } from "./orders.dto";
import { OrdersService } from "./orders.service";
import { ORDER_DELIVERY_ADDRESS_ROLES } from "./order-delivery-address";
import { isOrderImageName } from "./order-image-name";
import { ORDER_MODEL_IMAGE_ROLES } from "./order-model-image";
import { isOrderFileName } from "./order-file-policy";

@Controller("orders")
@UseGuards(SessionGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}
  @Get("defaults") @Roles("OWNER", "ADMIN", "MANAGER", "PRODUCTION") defaults() { return this.orders.defaults(); }
  @Get("production") @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.PRODUCTION) productionList(@Query("orderId") orderId?: string, @Query("from") from?: string, @Query("to") to?: string, @Query("overviewFilter") overviewFilter?: string) { return this.orders.productionList(orderId, from, to, overviewFilter); }
  @Get() @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER) list(@Query("search") search?: string, @Query("overviewFilter") overviewFilter?: string, @Query("period") period?: string) { return this.orders.list(search, { overviewFilter, period }); }
  @Get(":id") @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER) detail(@Param("id") id: string) { return this.orders.detail(id); }
  @Patch("archive") @Roles(UserRole.OWNER, UserRole.ADMIN) archiveOrders(@Body() dto: ArchiveOrdersDto, @Req() req: Request & { user: User }) { return this.orders.archiveOrders(dto, req.user); }
  @Post("maintenance/website-sales") @Roles(UserRole.OWNER, UserRole.ADMIN) correctWebsiteSales(@Body() dto: WebsiteSalesCorrectionDto, @Req() req: Request & { user: User }) { return this.orders.correctWebsiteSales(dto, req.user); }
  @Post("model-image") @Roles("OWNER", "ADMIN", "MANAGER") upload(@Body() dto: UploadModelImageDto) { return this.orders.upload(dto); }
  @Post() @Roles("OWNER", "ADMIN", "MANAGER") create(@Body() dto: CreateOrderDto, @Req() req: Request & { user: User }) { return this.orders.create(dto, req.user); }
  @Patch(":id/statuses") @Roles("OWNER", "ADMIN", "MANAGER") updateStatuses(@Param("id") id: string, @Body() dto: UpdateOrderStatusesDto, @Req() req: Request & { user: User }) { return this.orders.updateStatuses(id, dto, req.user); }
  @Patch(":id/deadline") @Roles("OWNER", "ADMIN", "MANAGER") updateDeadline(@Param("id") id: string, @Body() dto: UpdateOrderDeadlineDto, @Req() req: Request & { user: User }) { return this.orders.updateDeadline(id, dto, req.user); }
  @Patch(":id/currency") @Roles("OWNER", "ADMIN", "MANAGER") updateCurrency(@Param("id") id: string, @Body() dto: UpdateOrderCurrencyDto, @Req() req: Request & { user: User }) { return this.orders.updateCurrency(id, dto, req.user); }
  @Patch(":id/discipline") @Roles("OWNER", "ADMIN", "MANAGER") updateDiscipline(@Param("id") id: string, @Body() dto: UpdateOrderDisciplineDto, @Req() req: Request & { user: User }) { return this.orders.updateDiscipline(id, dto, req.user); }
  @Patch(":id/buyer-comment") @Roles("OWNER", "ADMIN", "MANAGER") updateBuyerComment(@Param("id") id: string, @Body() dto: UpdateOrderBuyerCommentDto, @Req() req: Request & { user: User }) { return this.orders.updateBuyerComment(id, dto, req.user); }
  @Patch(":id/delivery-contact") @Roles("OWNER", "ADMIN", "MANAGER") updateDeliveryContact(@Param("id") id: string, @Body() dto: UpdateOrderDeliveryContactDto, @Req() req: Request & { user: User }) { return this.orders.updateDeliveryContact(id, dto, req.user); }
  @Post(":id/files") @Roles("OWNER", "ADMIN", "MANAGER") uploadOrderFile(@Param("id") id: string, @Body() dto: UploadOrderFileDto, @Req() req: Request & { user: User }) { return this.orders.uploadOrderFile(id, dto, req.user); }
  @Patch(":id/model-image") @Roles(...ORDER_MODEL_IMAGE_ROLES) updateModelImage(@Param("id") id: string, @Body() dto: UpdateOrderModelImageDto, @Req() req: Request & { user: User }) { return this.orders.updateModelImage(id, dto, req.user); }
  @Patch(":id/details") @Roles(...ORDER_MODEL_IMAGE_ROLES) updateDetails(@Param("id") id: string, @Body() dto: UpdateOrderDetailsDto, @Req() req: Request & { user: User }) { return this.orders.updateDetails(id, dto, req.user); }
  @Patch(":id/items/:itemId") @Roles(...ORDER_MODEL_IMAGE_ROLES) updateItemDetails(@Param("id") id: string, @Param("itemId") itemId: string, @Body() dto: UpdateOrderItemDetailsDto, @Req() req: Request & { user: User }) { return this.orders.updateItemDetails(id, itemId, dto, req.user); }
  @Post(":id/items") @Roles(...ORDER_MODEL_IMAGE_ROLES) addItem(@Param("id") id: string, @Body() dto: AddOrderItemDto, @Req() req: Request & { user: User }) { return this.orders.addItem(id, dto, req.user); }
  @Patch(":id/items/:itemId/measurement") @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.PRODUCTION) bindItemMeasurement(@Param("id") id: string, @Param("itemId") itemId: string, @Body() dto: BindOrderItemMeasurementDto, @Req() req: Request & { user: User }) { return this.orders.bindItemMeasurement(id, itemId, dto, req.user); }
  @Patch(":id/delivery-address") @Roles(...ORDER_DELIVERY_ADDRESS_ROLES) updateDeliveryAddress(@Param("id") id: string, @Body() dto: UpdateOrderDeliveryAddressDto, @Req() req: Request & { user: User }) { return this.orders.updateDeliveryAddress(id, dto, req.user); }
  @Patch(":id/production-slot") @Roles("OWNER", "ADMIN", "MANAGER") updateProductionSlot(@Param("id") id: string, @Body() dto: UpdateProductionSlotDto, @Req() req: Request & { user: User }) { return this.orders.updateProductionSlot(id, dto, req.user); }
  @Delete(":id/production-slot") @Roles("OWNER", "ADMIN", "MANAGER") deleteProductionSlot(@Param("id") id: string, @Body() dto: DeleteProductionSlotDto, @Req() req: Request & { user: User }) { return this.orders.deleteProductionSlot(id, dto, req.user); }
  @Post(":id/payments") @Roles("OWNER", "ADMIN", "MANAGER") addPayment(@Param("id") id: string, @Body() dto: AddOrderPaymentDto, @Req() req: Request & { user: User }) { return this.orders.addPayment(id, dto, req.user); }
  @Post(":id/payments/:paymentId/void") @Roles("OWNER", "ADMIN", "ACCOUNTANT") voidPayment(@Param("id") id: string, @Param("paymentId") paymentId: string, @Body() dto: VoidOrderPaymentDto, @Req() req: Request & { user: User }) { return this.orders.voidPayment(id, paymentId, dto, req.user); }
  @Post(":id/measurement") @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.PRODUCTION) addMeasurement(@Param("id") id: string, @Body() dto: OrderMeasurementDto, @Req() req: Request & { user: User }) { return this.orders.addMeasurement(id, dto, req.user); }
  @Post(":orderId/items/:itemId/measurement") @Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER, UserRole.PRODUCTION) addItemMeasurement(@Param("orderId") orderId: string, @Param("itemId") itemId: string, @Body() dto: OrderMeasurementDto, @Req() req: Request & { user: User }) { return this.orders.addItemMeasurement(orderId, itemId, dto, req.user); }
  @Get("images/:name") image(@Param("name") name: string, @Res() res: Response) {
    if (!isOrderImageName(name)) return res.status(404).end();
    return res.sendFile(join(uploadsRoot(), "order-models", name));
  }
  @Get("files/:name") @Roles("OWNER", "ADMIN", "MANAGER") file(@Param("name") name: string, @Res() res: Response) {
    if (!isOrderFileName(name)) return res.status(404).end();
    return res.sendFile(join(uploadsRoot(), "order-files", name));
  }
}
