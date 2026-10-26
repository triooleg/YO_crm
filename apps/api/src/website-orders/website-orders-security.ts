import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';
import { WebsiteOrderError, websiteErrorMessage } from './website-orders-errors';

export function authorizeWebsiteOrder(header:unknown, secret=process.env.WEBSITE_ORDERS_API_TOKEN) {
 if(typeof secret!=='string'||secret.length<32||secret.length>512||/\s/.test(secret))throw new WebsiteOrderError('WEBSITE_DISABLED',503);
 const match=typeof header==='string'&&header.length<=520?/^Bearer ([^\s,]+)$/i.exec(header):null;
 const supplied=match?.[1]??'';
 const digest=(v:string)=>createHash('sha256').update(v).digest();
 const equal=timingSafeEqual(digest(supplied),digest(secret));
 if(!match||!equal)throw new WebsiteOrderError('WEBSITE_UNAUTHORIZED',401);
}
/** Reject unauthorized requests before parsing a bounded JSON body as well as in Nest. */
export function websiteOrdersSecurity(request:Request,response:Response,next:NextFunction){
 response.setHeader('Cache-Control','no-store');
 try{authorizeWebsiteOrder(request.headers.authorization);next();}catch(error){const e=error as WebsiteOrderError;response.status(e.status).json({ok:false,code:e.code,message:websiteErrorMessage(e.code)});}
}
export type WebsiteOrderPrincipal={kind:'legacy'}|{kind:'key';id:string;sourceAccount:string};
export interface WebsiteOrderAuthenticator {
 authenticate(header:unknown,attemptKey?:string):Promise<WebsiteOrderPrincipal>;
 authorizeSource(principal:WebsiteOrderPrincipal,sourceAccount:string):Promise<void>;
}
export const WEBSITE_ORDER_AUTHENTICATOR=Symbol('WEBSITE_ORDER_AUTHENTICATOR');
// Not enumerable, serializable or writable through request JSON.
const principals=new WeakMap<Request,WebsiteOrderPrincipal>();
export function websiteOrderPrincipal(request:Request):WebsiteOrderPrincipal {
 const principal=principals.get(request);
 if(!principal)throw new WebsiteOrderError('WEBSITE_UNAUTHORIZED',401);
 return principal;
}
export function createWebsiteOrdersSecurity(authenticator:Pick<WebsiteOrderAuthenticator,'authenticate'>){
 return async(request:Request,response:Response,next:NextFunction):Promise<void>=>{
  response.setHeader('Cache-Control','no-store');
  try{principals.set(request,await authenticator.authenticate(request.headers.authorization,request.ip||'unknown'));next();}
  catch(error){
   const known=error instanceof WebsiteOrderError;
   const code=known?error.code:'WEBSITE_DISABLED';
   if(known&&error.status===429)response.setHeader('Retry-After','60');
   response.status(known?error.status:503).json({ok:false,code,message:websiteErrorMessage(code)});
  }
 };
}
export const websiteOrdersBodyError:ErrorRequestHandler=(error,_request,response,next)=>{
 if(!error){next();return;}
 const large=error.status===413;
 response.status(large?413:400).json({ok:false,code:large?'WEBSITE_PAYLOAD_TOO_LARGE':'WEBSITE_INVALID_PAYLOAD',message:large?'Слишком большой запрос заказа.':websiteErrorMessage('WEBSITE_INVALID_PAYLOAD')});
};
@Injectable()
export class WebsiteOrdersGuard implements CanActivate {
 constructor(@Inject(WEBSITE_ORDER_AUTHENTICATOR) private readonly authenticator:WebsiteOrderAuthenticator){}
 async canActivate(context:ExecutionContext){
  const request=context.switchToHttp().getRequest<Request>();
  if(!principals.has(request))principals.set(request,await this.authenticator.authenticate(request.headers.authorization,request.ip||'unknown'));
  return true;
 }
}
