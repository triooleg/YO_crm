import { ParentMeasurementsRangesService } from './parent-measurements-ranges.service';
import { ParentRangesConfigureDto } from './parent-measurements-ranges.dto';
import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Req, Res, UseFilters, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { UserRole, type User } from '@prisma/client';
import type { Request,Response } from 'express';
import { Roles } from '../auth/roles.decorator';
import { SessionGuard } from '../auth/session.guard';
import { RolesGuard } from '../auth/roles.guard';
import { ParentMeasurementsService } from './parent-measurements.service';
import { ParentMeasurementsAccessService, type ParentMeasurementsContext } from './parent-measurements-access.service';
import { ParentMeasurementsGuard } from './parent-measurements.guard';
import { ParentMeasurementsExceptionFilter } from './parent-measurements-exception.filter';
import { clearParentMeasurementsCookie,setParentMeasurementsCookie } from './parent-measurements-security';
import { ParentAssignDto,ParentBindDto,ParentChildDto,ParentInviteDto,ParentPhotoDto,ParentRecoveryDto,ParentReviewDto,ParentRevisionDto,ParentSaveDto,ParentStartDto,ParentSubmitDto } from './parent-measurements.dto';

type ParentRequest=Request&{parentMeasurements:ParentMeasurementsContext};
function emptyBody(body:unknown){if(body!==undefined&&(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length))throw new BadRequestException('Запрос не должен содержать дополнительные поля');}
@ApiExcludeController()
@Controller('public/parent-measurements')
@UseGuards(ParentMeasurementsGuard)
@UseFilters(ParentMeasurementsExceptionFilter)
@UsePipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}))
export class ParentMeasurementsPublicController {
 constructor(private readonly access:ParentMeasurementsAccessService,private readonly data:ParentMeasurementsService,private readonly ranges:ParentMeasurementsRangesService){}
 @Post('start') async start(@Body() body:ParentStartDto,@Res({passthrough:true}) response:Response){const result=await this.access.start(body.token,body.locale,body.consent);setParentMeasurementsCookie(response,result.cookieToken,result.cookieExpiresAt);return {...result.session,ranges:await this.ranges.policy()};}
 @Post('recover') async recover(@Body() body:ParentRecoveryDto,@Res({passthrough:true}) response:Response){const result=await this.access.recover(body.token);setParentMeasurementsCookie(response,result.cookieToken,result.cookieExpiresAt);return {...result.session,ranges:await this.ranges.policy()};}
 @Get('session') async session(@Req() req:ParentRequest){return {...await this.access.session(req.parentMeasurements),ranges:await this.ranges.policy()};}
 @Post('children') create(@Req() req:ParentRequest,@Body() body:ParentChildDto){return this.data.createChild(req.parentMeasurements,body.firstName);}
 @Patch('children/:id') save(@Req() req:ParentRequest,@Param('id') id:string,@Body() body:ParentSaveDto){return this.data.saveDraft(req.parentMeasurements,id,body.revision,body.draft);}
 @Delete('children/:id') archive(@Req() req:ParentRequest,@Param('id') id:string,@Body() body:ParentRevisionDto){return this.data.archiveChild(req.parentMeasurements,id,body.revision);}
 @Post('children/:id/submit') submit(@Req() req:ParentRequest,@Param('id') id:string,@Body() body:ParentSubmitDto){return this.data.submit(req.parentMeasurements,id,body);}
 @Post('children/:id/revise') revise(@Req() req:ParentRequest,@Param('id') id:string,@Body() body:Record<string,unknown>){emptyBody(body);return this.data.revise(req.parentMeasurements,id);}
 @Post('recovery') recovery(@Req() req:ParentRequest,@Body() body:Record<string,unknown>){emptyBody(body);return this.access.createRecovery(req.parentMeasurements);}
 @Post('share') share(@Req() req:ParentRequest,@Body() body:Record<string,unknown>){emptyBody(body);return this.access.share(req.parentMeasurements);}
 @Post('photos/:id') photoUpload(@Req() req:ParentRequest,@Param('id') id:string,@Body() body:ParentPhotoDto){return this.data.uploadPhoto(req.parentMeasurements,id,body.mimeType,body.base64);}
 @Get('photos/:id') async photo(@Req() req:ParentRequest,@Param('id') id:string,@Res() response:Response){const bytes=await this.data.photo(req.parentMeasurements,id);response.type('image/jpeg').setHeader('Content-Disposition','inline; filename="photo.jpg"');response.send(bytes);}
 @Post('logout') async logout(@Req() req:ParentRequest,@Res({passthrough:true}) response:Response,@Body() body:Record<string,unknown>){emptyBody(body);await this.access.logout(req.parentMeasurements);clearParentMeasurementsCookie(response);return {ok:true};}
}

@Controller('orders/:orderId/parent-measurements')
@UseGuards(SessionGuard,RolesGuard)
@Roles(UserRole.OWNER,UserRole.ADMIN,UserRole.MANAGER)
@UsePipes(new ValidationPipe({whitelist:true,forbidNonWhitelisted:true,transform:true}))
export class ParentMeasurementsStaffController {
 constructor(private readonly access:ParentMeasurementsAccessService,private readonly data:ParentMeasurementsService){}
 @Get() dashboard(@Param('orderId') orderId:string){return this.data.dashboard(orderId);}
 @Post('invitations') invite(@Param('orderId') orderId:string,@Body() body:ParentInviteDto,@Req() req:Request&{user:User}){return this.access.issue(orderId,body,req.user.id);}
 @Post('invitations/:id/revoke') revoke(@Param('orderId') orderId:string,@Param('id') id:string,@Req() req:Request&{user:User}){return this.access.revoke(orderId,id,req.user.id);}
 @Get('submissions/:id/photo') async photo(@Param('orderId') orderId:string,@Param('id') id:string,@Res() response:Response){const bytes=await this.data.staffPhoto(orderId,id);response.setHeader('Cache-Control','no-store');response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Content-Type-Options','nosniff');response.type('image/jpeg').send(bytes);}
 @Post('submissions/:id/review') review(@Param('orderId') orderId:string,@Param('id') id:string,@Body() body:ParentReviewDto,@Req() req:Request&{user:User}){return this.data.review(orderId,id,body,req.user);}
 @Post('submissions/:id/assign') assign(@Param('orderId') orderId:string,@Param('id') id:string,@Body() body:ParentAssignDto,@Req() req:Request&{user:User}){return this.data.assign(orderId,id,body,req.user);}
 @Post('children/:id/bind') bind(@Param('orderId') orderId:string,@Param('id') id:string,@Body() body:ParentBindDto,@Req() req:Request&{user:User}){return this.data.bindAthlete(orderId,id,body,req.user);}
}

@Controller('parent-measurements/settings/ranges')
@UseGuards(SessionGuard,RolesGuard)
@Roles(UserRole.OWNER,UserRole.ADMIN)
export class ParentMeasurementsRangesController {
 constructor(private readonly ranges:ParentMeasurementsRangesService){}
 @Get() policy(){return this.ranges.policy();}
 @Put() configure(@Body() body:ParentRangesConfigureDto,@Req() req:Request&{user:User}){return this.ranges.configure(body,req.user);}
}
