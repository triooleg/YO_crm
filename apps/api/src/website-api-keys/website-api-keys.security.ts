import { CanActivate, Catch, ExecutionContext, ExceptionFilter, ArgumentsHost, HttpException, Injectable, ForbiddenException, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { enforceAuthRateLimit } from '../auth/auth-rate-limit';

export const WEBSITE_API_KEYS_RATE_LIMIT=Symbol('WEBSITE_API_KEYS_RATE_LIMIT');
export type WebsiteApiKeysRateLimit=(scope:string,identity:string,limit:number,windowSeconds:number)=>Promise<void>;
export const enforceWebsiteApiKeysRateLimit:WebsiteApiKeysRateLimit=async(scope,identity,limit,seconds)=>{
 try{await enforceAuthRateLimit(`website-keys:${scope}`,identity,limit,seconds);}
 catch(error){if(error instanceof HttpException&&error.getStatus()===429)throw new HttpException('Слишком много запросов. Повторите позже',429);throw new ServiceUnavailableException('Защита управления ключами временно недоступна');}
};
export const WEBSITE_KEY_COOKIE='yoleotard_crm_session';
export type WebsiteApiKeysRequest={sessionToken:string;ip:string;origin:unknown;contentType:unknown;csrf:unknown;fetchSite?:unknown};
export function websiteApiKeysRequest(req:Request):WebsiteApiKeysRequest {
 return {sessionToken:req.cookies?.[WEBSITE_KEY_COOKIE]??'',ip:req.ip||'unknown',origin:req.headers.origin,
  contentType:req.headers['content-type'],csrf:req.headers['x-website-key-csrf'],fetchSite:req.headers['sec-fetch-site']};
}
export function digestWebsiteApiKey(token:string):Buffer {
 return createHash('sha256').update('yo-crm:website-api-key:sha256-v1\0').update(token).digest();
}
export function generateWebsiteApiKey(){
 const selector=randomBytes(8).toString('hex'),secret=`yo_crm_v1_${selector}_${randomBytes(32).toString('base64url')}`;
 return {selector,secret,digest:digestWebsiteApiKey(secret)};
}
export function parseWebsiteApiKey(value:string):{selector:string}|null {
 const m=/^yo_crm_v1_([a-f0-9]{16})_([A-Za-z0-9_-]{43})$/.exec(value);
 return m&&Buffer.from(m[2]!,'base64url').toString('base64url')===m[2]?{selector:m[1]!}:null;
}
export function websiteBearer(header:unknown):string|null {
 return typeof header==='string'&&header.length<=520?/^Bearer ([^\s,]+)$/i.exec(header)?.[1]??null:null;
}
export function legacyWebsiteTokenConfigured():boolean {
 const v=process.env.WEBSITE_ORDERS_API_TOKEN;return typeof v==='string'&&v.length>=32&&v.length<=512&&!/\s/.test(v);
}
export function constantTimeTokenEqual(a:string,b:string):boolean {
 return timingSafeEqual(createHash('sha256').update(a).digest(),createHash('sha256').update(b).digest());
}
export function websiteApiKeysCsrf(sessionToken:string):string {
 if(!/^[A-Za-z0-9_-]{43}$/.test(sessionToken))throw new UnauthorizedException('Требуется действующая сессия');
 return createHash('sha256').update('yo-crm:website-api-key:csrf:v1\0').update(sessionToken).digest('hex');
}
function origins():string[]{
 const entries=(process.env.WEB_ORIGIN??'').split(',').map(x=>x.trim()).filter(Boolean);
 if(!entries.length||entries.some(value=>{try{const u=new URL(value);return u.origin!==value||!['https:','http:'].includes(u.protocol)||(process.env.NODE_ENV==='production'&&u.protocol!=='https:');}catch{return true;}}))throw new ServiceUnavailableException('Настройки безопасности временно недоступны');
 return entries;
}
export function assertWebsiteApiKeysRequest(context:WebsiteApiKeysRequest,mutation:boolean):void {
 const expected=websiteApiKeysCsrf(context.sessionToken),allowedOrigins=origins();
 if(context.fetchSite!==undefined&&!['same-origin','none'].includes(String(context.fetchSite)))throw new ForbiddenException('Недопустимый источник запроса');
 if(mutation||context.origin!==undefined){if(typeof context.origin!=='string'||!allowedOrigins.includes(context.origin))throw new ForbiddenException('Недопустимый источник запроса');}
 if(!mutation)return;
 if(typeof context.contentType!=='string'||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(context.contentType))throw new ForbiddenException('Требуется JSON');
 if(typeof context.csrf!=='string'||!/^[a-f0-9]{64}$/.test(context.csrf)||!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(context.csrf,'hex')))throw new ForbiddenException('Проверка безопасности не пройдена');
}
@Injectable()
export class WebsiteApiKeysHeadersGuard implements CanActivate {
 canActivate(context:ExecutionContext){context.switchToHttp().getResponse<Response>().setHeader('Cache-Control','no-store');return true;}
}
/** Never log/rethrow raw Prisma/Redis/body data; includes guard and DTO failures. */
@Catch()
export class WebsiteApiKeysExceptionFilter implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost){
  const status=error instanceof HttpException?error.getStatus():503;
  const messages:Record<number,string>={400:'Некорректные данные ключа',401:'Требуется действующая сессия или верный текущий пароль',403:'Недостаточно прав или проверка безопасности не пройдена',404:'Ключ не найден',409:'Не удалось выполнить операцию с ключом',413:'Слишком большой запрос',429:'Слишком много запросов. Повторите позже'};
  host.switchToHttp().getResponse<Response>().setHeader('Cache-Control','no-store').status(status).json({message:messages[status]??'Управление ключами временно недоступно'});
 }
}
