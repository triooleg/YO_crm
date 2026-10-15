import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { ShippingCarrier, User } from "@prisma/client";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { ShippingService } from "./shipping.service";
import { ArchiveOrderShipmentDto, UpdateCarrierSettingDto, UpsertOrderShipmentDto, UpsertShipmentDto } from "./shipping.dto";

@Controller("shipping") @UseGuards(SessionGuard,RolesGuard)
export class ShippingController {
  constructor(private readonly shipping:ShippingService){}
  @Get() @Roles("OWNER","ADMIN","MANAGER") list(@Query("filter") filter?:string,@Query("horizon") horizon?:string){return this.shipping.list({filter,horizon:horizon===undefined?undefined:Number(horizon)})}
  @Put("orders/:orderId") @Roles("OWNER","ADMIN","MANAGER") upsert(@Param("orderId") orderId:string,@Body() dto:UpsertShipmentDto,@Req() req:Request&{user:User}){return this.shipping.upsert(orderId,dto,req.user)}
  @Get("orders/:orderId/shipments") @Roles("OWNER","ADMIN","MANAGER") shipments(@Param("orderId") orderId:string){return this.shipping.shipments(orderId)}
  @Post("orders/:orderId/shipments") @Roles("OWNER","ADMIN","MANAGER") createShipment(@Param("orderId") orderId:string,@Body() dto:UpsertOrderShipmentDto,@Req() req:Request&{user:User}){return this.shipping.createShipment(orderId,dto,req.user)}
  @Put("orders/:orderId/shipments/:shipmentId") @Roles("OWNER","ADMIN","MANAGER") updateShipment(@Param("orderId") orderId:string,@Param("shipmentId") shipmentId:string,@Body() dto:UpsertOrderShipmentDto,@Req() req:Request&{user:User}){return this.shipping.updateShipment(orderId,shipmentId,dto,req.user)}
  @Delete("orders/:orderId/shipments/:shipmentId") @Roles("OWNER","ADMIN") archiveShipment(@Param("orderId") orderId:string,@Param("shipmentId") shipmentId:string,@Body() dto:ArchiveOrderShipmentDto,@Req() req:Request&{user:User}){return this.shipping.archiveShipment(orderId,shipmentId,dto.expectedUpdatedAt,req.user)}
  @Get("carriers") @Roles("OWNER","ADMIN","MANAGER") carriers(){return this.shipping.carriers()}
  @Get("carrier-settings") @Roles("OWNER","ADMIN") carrierSettings(){return this.shipping.carrierSettings()}
  @Patch("carriers/:carrier") @Roles("OWNER","ADMIN") saveCarrier(@Param("carrier") carrier:ShippingCarrier,@Body() dto:UpdateCarrierSettingDto,@Req() req:Request&{user:User}){return this.shipping.saveCarrier(carrier,dto,req.user)}
}
