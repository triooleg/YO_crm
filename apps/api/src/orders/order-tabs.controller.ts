import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import type { Response } from "express";
import { join } from "node:path";
import { UserRole, type User } from "@prisma/client";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { SessionGuard } from "../auth/session.guard";
import { uploadsRoot } from "../uploads";
import { isOrderFileName } from "./order-file-policy";
import { CreateInstanceMeasurementDto, CreateOrderNoteDto, CreateOrderTagDto, UpdateClientPreferencesDto, UpdateOrderFileRoleDto, UpdateOrderItemInstanceDto, UpdateOrderNoteDto, UploadClientFileDto } from "./order-tabs.dto";
import { OrderTabsService } from "./order-tabs.service";
@Controller("order-tabs") @UseGuards(SessionGuard,RolesGuard)
export class OrderTabsController {
  constructor(private readonly tabs:OrderTabsService){}
  @Post(":orderId/instances/:instanceId/measurement")
  @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER,UserRole.PRODUCTION)
  addInstanceMeasurement(@Param("orderId") orderId:string,@Param("instanceId") instanceId:string,@Body() dto:CreateInstanceMeasurementDto,@Req() req:Request&{user:User}){return this.tabs.addInstanceMeasurement(orderId,instanceId,dto,req.user)}
  @Get("orders/:orderId") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) detail(@Param("orderId") orderId:string){return this.tabs.detail(orderId)}
  @Post(":orderId/notes") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) createNote(@Param("orderId") orderId:string,@Body() dto:CreateOrderNoteDto,@Req() req:Request&{user:User}){return this.tabs.createNote(orderId,dto,req.user)}
  @Patch(":orderId/notes/:noteId") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) updateNote(@Param("orderId") orderId:string,@Param("noteId") noteId:string,@Body() dto:UpdateOrderNoteDto,@Req() req:Request&{user:User}){return this.tabs.updateNote(orderId,noteId,dto,req.user)}
  @Delete(":orderId/notes/:noteId") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) archiveNote(@Param("orderId") orderId:string,@Param("noteId") noteId:string,@Req() req:Request&{user:User}){return this.tabs.archiveNote(orderId,noteId,req.user)}
  @Post(":orderId/tags") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) createTag(@Param("orderId") orderId:string,@Body() dto:CreateOrderTagDto,@Req() req:Request&{user:User}){return this.tabs.createTag(orderId,dto,req.user)}
  @Delete(":orderId/tags/:tagId") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) deleteTag(@Param("orderId") orderId:string,@Param("tagId") tagId:string,@Req() req:Request&{user:User}){return this.tabs.deleteTag(orderId,tagId,req.user)}
  @Patch(":orderId/instances/:instanceId") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) updateInstance(@Param("orderId") orderId:string,@Param("instanceId") instanceId:string,@Body() dto:UpdateOrderItemInstanceDto,@Req() req:Request&{user:User}){return this.tabs.updateInstance(orderId,instanceId,dto,req.user)}
  @Patch(":orderId/files/:fileId") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) updateFileRole(@Param("orderId") orderId:string,@Param("fileId") fileId:string,@Body() dto:UpdateOrderFileRoleDto,@Req() req:Request&{user:User}){return this.tabs.updateFileRole(orderId,fileId,dto,req.user)}
  @Patch("clients/:clientId/preferences") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) updateClientPreferences(@Param("clientId") clientId:string,@Body() dto:UpdateClientPreferencesDto,@Req() req:Request&{user:User}){return this.tabs.updateClientPreferences(clientId,dto,req.user)}
  @Post("clients/:clientId/files") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) uploadClientFile(@Param("clientId") clientId:string,@Body() dto:UploadClientFileDto,@Req() req:Request&{user:User}){return this.tabs.uploadClientFile(clientId,dto,req.user)}
  @Get("client-files/:name") @Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER) clientFile(@Param("name") name:string,@Res() res:Response){if(!isOrderFileName(name))return res.status(404).end();return res.sendFile(join(uploadsRoot(),"client-files",name))}
}
