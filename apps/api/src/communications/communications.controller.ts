import{Body,Controller,Get,Header,Headers,HttpCode,Param,Patch,Post,Query,Req,UseGuards}from"@nestjs/common";
import{type User}from"@prisma/client";
import type{Request}from"express";
import{Roles}from"../auth/roles.decorator";
import{RolesGuard}from"../auth/roles.guard";
import{SessionGuard}from"../auth/session.guard";
import{AiRequestDto,AiSettingsDto,ConversationQueryDto,IntegrationSettingsDto,MessageTemplateDto,MetaIntegrationDto,SendMessageDto}from"./communications.dto";
import{AiAssistantService,CommunicationsService}from"./communications.service";

@Controller("communications")@UseGuards(SessionGuard,RolesGuard)
export class CommunicationsController{constructor(private c:CommunicationsService){}
@Get()@Roles("OWNER","ADMIN","MANAGER")list(){return this.c.list()}
@Get("templates")@Roles("OWNER","ADMIN","MANAGER")templates(){return this.c.templates()}
@Post("templates")@Roles("OWNER","ADMIN")createTemplate(@Body()d:MessageTemplateDto,@Req()r:Request&{user:User}){return this.c.createTemplate(d,r.user)}
@Patch("templates/:id")@Roles("OWNER","ADMIN")updateTemplate(@Param("id")id:string,@Body()d:MessageTemplateDto,@Req()r:Request&{user:User}){return this.c.updateTemplate(id,d,r.user)}
@Post("templates/:id/archive")@Roles("OWNER","ADMIN")archiveTemplate(@Param("id")id:string,@Req()r:Request&{user:User}){return this.c.archiveTemplate(id,r.user)}
@Get("integrations")@Roles("OWNER","ADMIN")integrations(){return this.c.integrations()}
@Patch("integrations/:channel")@Roles("OWNER","ADMIN")saveIntegration(@Param("channel")channel:string,@Body()d:IntegrationSettingsDto,@Req()r:Request&{user:User}){return this.c.saveIntegration(channel,d,r.user)}
@Get("meta/settings")@Roles("OWNER","ADMIN")metaSettings(){return this.c.metaSettings()}
@Patch("meta/settings")@Roles("OWNER","ADMIN")saveMetaSettings(@Body()d:MetaIntegrationDto,@Req()r:Request&{user:User}){return this.c.saveMetaSettings(d,r.user)}
@Get(":clientId")@Roles("OWNER","ADMIN","MANAGER")detail(@Param("clientId")id:string,@Query()query:ConversationQueryDto){return this.c.detail(id,query.channel)}
@Post(":clientId/messages")@Roles("OWNER","ADMIN","MANAGER")send(@Param("clientId")id:string,@Body()d:SendMessageDto,@Req()r:Request&{user:User}){return this.c.send(id,d,r.user)}}

@Controller("communications/meta")
export class MetaWebhookController{constructor(private c:CommunicationsService){}
@Get("webhook")@Header("Content-Type","text/plain")verify(@Query("hub.mode")mode?:string,@Query("hub.verify_token")token?:string,@Query("hub.challenge")challenge?:string){return this.c.verifyMetaWebhook(mode,token,challenge)}
@Post("webhook")@HttpCode(200)receive(@Headers("x-hub-signature-256")signature:string|undefined,@Req()request:Request&{rawBody?:Buffer},@Body()body:unknown){return this.c.receiveMetaWebhook(request.rawBody??Buffer.from(JSON.stringify(body)),signature,body)}}

@Controller("communications/chatwoot")
export class ChatwootWebhookController{constructor(private c:CommunicationsService){}
@Post("webhook")@HttpCode(200)receive(@Headers("x-chatwoot-signature")signature:string|undefined,@Query("token")token:string|undefined,@Req()request:Request&{rawBody?:Buffer},@Body()body:unknown){return this.c.receiveChatwootWebhook(request.rawBody??Buffer.from(JSON.stringify(body)),signature,token,body)}}

@Controller("ai-assistant")@UseGuards(SessionGuard,RolesGuard)
export class AiAssistantController{constructor(private a:AiAssistantService){}@Get("settings")@Roles("OWNER","ADMIN")settings(){return this.a.settings()}@Patch("settings")@Roles("OWNER","ADMIN")save(@Body()d:AiSettingsDto,@Req()r:Request&{user:User}){return this.a.save(d,r.user)}@Post("generate")@Roles("OWNER","ADMIN","MANAGER")generate(@Body()d:AiRequestDto,@Req()r:Request&{user:User}){return this.a.generateLimited(d,r.user)}}
