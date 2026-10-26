import { Body, Controller, Get, Param, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { User } from '@prisma/client';
import type { Request } from 'express';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SessionGuard } from '../auth/session.guard';
import { WebsiteApiKeysService } from './website-api-keys.service';
import { WebsiteApiKeysExceptionFilter, WebsiteApiKeysHeadersGuard, websiteApiKeysRequest } from './website-api-keys.security';

@Controller('auth/website-api-keys')
@UseGuards(WebsiteApiKeysHeadersGuard,SessionGuard,RolesGuard)
@UseFilters(WebsiteApiKeysExceptionFilter)
@Roles('OWNER')
export class WebsiteApiKeysController {
 constructor(private readonly keys:WebsiteApiKeysService){}
 @Get() list(@Req() request:Request&{user:User}){return this.keys.list(request.user,websiteApiKeysRequest(request));}
 // Unknown is deliberate: the legacy global whitelist must not erase extras
 // before this feature's explicit strict DTO parser sees the original payload.
 @Post() create(@Body() body:unknown,@Req() request:Request&{user:User}){return this.keys.create(request.user,body,websiteApiKeysRequest(request));}
 @Post(':id/rotate') rotate(@Param('id') id:string,@Body() body:unknown,@Req() request:Request&{user:User}){return this.keys.rotate(request.user,id,body,websiteApiKeysRequest(request));}
 @Post(':id/revoke') revoke(@Param('id') id:string,@Body() body:unknown,@Req() request:Request&{user:User}){return this.keys.revoke(request.user,id,body,websiteApiKeysRequest(request));}
}
