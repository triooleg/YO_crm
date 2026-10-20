import {Body,Controller,Get,Patch,Query,Req,UseGuards} from "@nestjs/common";
import {User} from "@prisma/client";
import {Request} from "express";
import {Roles} from "../auth/roles.decorator";
import {RolesGuard} from "../auth/roles.guard";
import {SessionGuard} from "../auth/session.guard";
import {AiRuntimeStatusQueryDto,UpdateAiRuntimeSettingDto} from "./ai-control.dto";
import {AiControlService} from "./ai-control.service";
@Controller("ai-control") @UseGuards(SessionGuard,RolesGuard)
export class AiControlController{
  constructor(private readonly service:AiControlService){}
  @Get("status") @Roles("OWNER","ADMIN") status(@Query()query:AiRuntimeStatusQueryDto){return this.service.status(query)}
  @Patch("settings") @Roles("OWNER") update(@Body()dto:UpdateAiRuntimeSettingDto,@Req()request:Request&{user:User}){return this.service.update(dto,request.user)}
}
