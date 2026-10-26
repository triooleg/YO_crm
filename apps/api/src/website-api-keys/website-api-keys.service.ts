import { BadRequestException, ForbiddenException, HttpException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import type { Prisma, User, WebsiteApiKey } from '@prisma/client';
import argon2 from 'argon2';
import { createHash, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../prisma.service';
import { normalizeWebsiteSourceAccount } from '../website-orders/website-orders-contract';
import { WebsiteOrderError } from '../website-orders/website-orders-errors';
import { CreateWebsiteApiKeyDto, RotateWebsiteApiKeyDto, RevokeWebsiteApiKeyDto, parseWebsiteApiKeysCommand } from './website-api-keys.dto';
import { assertWebsiteApiKeysRequest, constantTimeTokenEqual, digestWebsiteApiKey, enforceWebsiteApiKeysRateLimit, generateWebsiteApiKey, legacyWebsiteTokenConfigured, parseWebsiteApiKey, WEBSITE_API_KEYS_RATE_LIMIT, websiteApiKeysCsrf, websiteBearer } from './website-api-keys.security';
import type { WebsiteApiKeysRateLimit, WebsiteApiKeysRequest } from './website-api-keys.security';

export type WebsiteApiKeyPrincipal=Readonly<{kind:'legacy'}|{kind:'key';id:string;sourceAccount:string}>;
export type WebsiteApiKeyMetadata={id:string;name:string;selector:string;sourceAccount:string;createdAt:string;lastUsedAt:string|null;revokedAt:string|null;createdById:string;revokedById:string|null;rotatedFromId:string|null};
type Actor=Pick<User,'id'|'role'>;
const publicSelect={id:true,name:true,selector:true,sourceAccount:true,createdAt:true,lastUsedAt:true,revokedAt:true,createdById:true,revokedById:true,rotatedFromId:true} as const;
type PublicRow=Prisma.WebsiteApiKeyGetPayload<{select:typeof publicSelect}>;
const metadata=(row:PublicRow):WebsiteApiKeyMetadata=>({id:row.id,name:row.name,selector:row.selector,sourceAccount:row.sourceAccount,createdAt:row.createdAt.toISOString(),lastUsedAt:row.lastUsedAt?.toISOString()??null,revokedAt:row.revokedAt?.toISOString()??null,createdById:row.createdById,revokedById:row.revokedById,rotatedFromId:row.rotatedFromId});
const sessionHash=(value:string)=>createHash('sha256').update(value).digest('hex');
const failure=()=>new WebsiteOrderError('WEBSITE_UNAUTHORIZED',401);

@Injectable()
export class WebsiteApiKeysService {
 private readonly principals=new WeakMap<object,Buffer|null>();
 constructor(private readonly prisma:PrismaService,@Inject(WEBSITE_API_KEYS_RATE_LIMIT) private readonly limiter:WebsiteApiKeysRateLimit=enforceWebsiteApiKeysRateLimit){}

 async authenticate(header:unknown,attemptKey="unknown"):Promise<WebsiteApiKeyPrincipal>{
  const token=websiteBearer(header);
  if(token&&legacyWebsiteTokenConfigured()&&constantTimeTokenEqual(token,process.env.WEBSITE_ORDERS_API_TOKEN!)){
   const principal=Object.freeze({kind:'legacy'} as const);this.principals.set(principal,null);return principal;
  }
  const parsed=token?parseWebsiteApiKey(token):null;
  if(!token||!parsed)throw legacyWebsiteTokenConfigured()||Boolean(token&&/^yo_crm_/i.test(token))?failure():new WebsiteOrderError('WEBSITE_DISABLED',503);
  const identity=typeof attemptKey==='string'&&attemptKey.length>0&&attemptKey.length<=200?attemptKey:'unknown';
  try{await this.limiter('ingress-ip',identity,120,60);}
  catch(error){if(error instanceof HttpException&&error.getStatus()===429)throw new WebsiteOrderError('WEBSITE_RATE_LIMITED',429);throw new WebsiteOrderError('WEBSITE_DISABLED',503);}
  const digest=digestWebsiteApiKey(token);
  let row:Pick<WebsiteApiKey,'id'|'digest'|'digestVersion'|'sourceAccount'|'revokedAt'>|null;
  try{row=await this.prisma.websiteApiKey.findUnique({where:{selector:parsed.selector},select:{id:true,digest:true,digestVersion:true,sourceAccount:true,revokedAt:true}});}
  catch{throw new WebsiteOrderError('WEBSITE_DISABLED',503);}
  if(!row||row.revokedAt||row.digestVersion!=='sha256-v1'||row.digest.length!==32||!timingSafeEqual(Buffer.from(row.digest),digest))throw failure();
  try{if(normalizeWebsiteSourceAccount(row.sourceAccount)!==row.sourceAccount)throw failure();}catch{throw failure();}
  const principal=Object.freeze({kind:'key',id:row.id,sourceAccount:row.sourceAccount} as const);this.principals.set(principal,digest);return principal;
 }

 async authorizeSource(principal:WebsiteApiKeyPrincipal,sourceAccount:string):Promise<void>{
  if(!principal||!this.principals.has(principal))throw failure();
  if(principal.kind==='legacy')return;
  if(sourceAccount!==principal.sourceAccount)throw new WebsiteOrderError('WEBSITE_SOURCE_NOT_ALLOWED',403);
  const digest=this.principals.get(principal)!;
  try{
   await this.prisma.$transaction(async tx=>{
    await tx.$queryRaw`SELECT "id" FROM "WebsiteApiKey" WHERE "id"=${principal.id} FOR UPDATE`;
    const row=await tx.websiteApiKey.findUnique({where:{id:principal.id},select:{digest:true,digestVersion:true,sourceAccount:true,revokedAt:true}});
    if(!row||row.revokedAt||row.sourceAccount!==sourceAccount||row.digestVersion!=='sha256-v1'||row.digest.length!==32||!timingSafeEqual(Buffer.from(row.digest),digest))throw failure();
    const now=new Date(),cutoff=new Date(now.getTime()-300_000);
    await tx.websiteApiKey.updateMany({where:{id:principal.id,revokedAt:null,sourceAccount,OR:[{lastUsedAt:null},{lastUsedAt:{lte:cutoff}}]},data:{lastUsedAt:now}});
   });
  }catch(error){if(error instanceof WebsiteOrderError)throw error;throw new WebsiteOrderError('WEBSITE_DISABLED',503);}
 }

 private assertOwner(actor:Actor){if(!actor||actor.role!=='OWNER')throw new ForbiddenException('Недостаточно прав');}
 private async managementLimit(actor:Actor,ctx:WebsiteApiKeysRequest,mutation:boolean){
  this.assertOwner(actor);assertWebsiteApiKeysRequest(ctx,mutation);
  try{
   await this.limiter(mutation?'manage-ip':'list-ip',ctx.ip,mutation?20:120,mutation?900:60);
   await this.limiter(mutation?'manage-actor':'list-actor',actor.id,mutation?5:60,mutation?900:60);
  }catch(error){if(error instanceof HttpException&&error.getStatus()===429)throw error;throw new ServiceUnavailableException('Защита управления ключами временно недоступна');}
 }
 private async freshOwner(tx:Prisma.TransactionClient,actor:Actor,ctx:WebsiteApiKeysRequest){
  const user=await tx.user.findFirst({where:{id:actor.id,active:true,archivedAt:null,role:'OWNER'}});
  const session=await tx.session.findFirst({where:{userId:actor.id,tokenHash:sessionHash(ctx.sessionToken),expiresAt:{gt:new Date()}},select:{id:true}});
  if(!user||!session)throw new UnauthorizedException('Требуется действующая сессия владельца');return user;
 }
 async list(actor:Actor,ctx:WebsiteApiKeysRequest):Promise<{keys:WebsiteApiKeyMetadata[];csrfToken:string;legacyConfigured:boolean}>{
  await this.managementLimit(actor,ctx,false);
  try{
   return await this.prisma.$transaction(async tx=>{
    await this.freshOwner(tx,actor,ctx);
    const rows=await tx.websiteApiKey.findMany({select:publicSelect,orderBy:[{createdAt:'desc'},{id:'desc'}]});
    return {keys:rows.map(metadata),csrfToken:websiteApiKeysCsrf(ctx.sessionToken),legacyConfigured:legacyWebsiteTokenConfigured()};
   });
  }catch(error){this.safeManagementError(error);}
 }
 async create(actor:Actor,input:unknown,ctx:WebsiteApiKeysRequest){
  const body=parseWebsiteApiKeysCommand(CreateWebsiteApiKeyDto,input);
  let account:string;try{account=normalizeWebsiteSourceAccount(body.sourceAccount);}catch{throw new BadRequestException('Некорректный источник ключа');}
  if(account!=='calendar.yoleotard.com')throw new BadRequestException('Этот источник пока не поддерживается');
  return this.mutate(actor,ctx,body,async(tx,user)=>this.insert(tx,user,body.name,account,null));
 }
 async rotate(actor:Actor,id:string,input:unknown,ctx:WebsiteApiKeysRequest){
  const body=parseWebsiteApiKeysCommand(RotateWebsiteApiKeyDto,input);this.assertId(id);
  const account=this.account(body.sourceAccount);
  return this.mutate(actor,ctx,body,async(tx,user)=>{
   const old=await tx.websiteApiKey.findUnique({where:{id},select:publicSelect});if(!old)throw new NotFoundException('Ключ не найден');
   return this.insert(tx,user,body.name,account,old.id);
  });
 }
 async revoke(actor:Actor,id:string,input:unknown,ctx:WebsiteApiKeysRequest){
  const body=parseWebsiteApiKeysCommand(RevokeWebsiteApiKeyDto,input);this.assertId(id);
  return this.mutate(actor,ctx,body,async(tx,user)=>{
   // Serialize different owners and ingress authorization on the key row.
   await tx.$queryRaw`SELECT "id" FROM "WebsiteApiKey" WHERE "id"=${id} FOR UPDATE`;
   const before=await tx.websiteApiKey.findUnique({where:{id},select:publicSelect});if(!before)throw new NotFoundException('Ключ не найден');
   if(before.revokedAt)return {key:metadata(before)};
   const saved=await tx.websiteApiKey.update({where:{id},data:{revokedAt:new Date(),revokedById:user.id},select:publicSelect});
   await tx.auditLog.create({data:{actorId:user.id,action:'REVOKE',entityType:'WebsiteApiKey',entityId:saved.id,before:metadata(before),after:metadata(saved)}});
   return {key:metadata(saved)};
  });
 }
 private assertId(id:string){if(typeof id!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new BadRequestException('Некорректный ключ');}
 private account(value:unknown){try{return normalizeWebsiteSourceAccount(value);}catch{throw new BadRequestException('Некорректный аккаунт сайта');}}
 private async mutate<T>(actor:Actor,ctx:WebsiteApiKeysRequest,input:RevokeWebsiteApiKeyDto,operation:(tx:Prisma.TransactionClient,user:User)=>Promise<T>):Promise<T>{
  await this.managementLimit(actor,ctx,true);
  try{
   return await this.prisma.$transaction(async tx=>{
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${actor.id}))`;
    const user=await this.freshOwner(tx,actor,ctx);
    let passwordValid=false;try{passwordValid=await argon2.verify(user.passwordHash,input.currentPassword);}catch{}
    if(!passwordValid)throw new UnauthorizedException('Текущий пароль указан неверно');
    return operation(tx,user);
   });
  }catch(error){this.safeManagementError(error);}
 }
 private async insert(tx:Prisma.TransactionClient,user:User,name:string,sourceAccount:string,rotatedFromId:string|null){
  const generated=generateWebsiteApiKey();
  const row=await tx.websiteApiKey.create({data:{name,sourceAccount,selector:generated.selector,digest:Uint8Array.from(generated.digest),digestVersion:'sha256-v1',createdById:user.id,rotatedFromId,createdAt:new Date()},select:publicSelect});
  await tx.auditLog.create({data:{actorId:user.id,action:rotatedFromId?'ROTATE':'CREATE',entityType:'WebsiteApiKey',entityId:row.id,after:metadata(row)}});
  return {key:metadata(row),secret:generated.secret};
 }
 private safeManagementError(error:unknown):never {
  if(error instanceof HttpException&&[400,401,403,404,409,429].includes(error.getStatus()))throw error;
  throw new ServiceUnavailableException('Управление ключами временно недоступно');
 }
}
