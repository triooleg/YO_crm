import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Header, HttpCode, Inject, Post, Req, UseFilters, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { WebsiteOrdersService } from './website-orders.service';
import { WEBSITE_ORDER_AUTHENTICATOR, WebsiteOrdersGuard, websiteOrderPrincipal, type WebsiteOrderAuthenticator } from './website-orders-security';
import { parseWebsiteOrder } from './website-orders-contract';
import { WebsiteOrderError, websiteErrorMessage } from './website-orders-errors';

@Catch()
export class WebsiteOrdersExceptionFilter implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost){
  const known=error instanceof WebsiteOrderError;
  const conflict=!!error&&typeof error==='object'&&'code' in error&&['P2002','P2034'].includes(String(error.code));
  const code=known?error.code:conflict?'WEBSITE_ORDER_CONFLICT':'WEBSITE_ORDER_FAILED';
  if(known&&error.status===429)host.switchToHttp().getResponse<Response>().setHeader('Retry-After','60');
  host.switchToHttp().getResponse<Response>().status(known?error.status:conflict?409:500).setHeader('Cache-Control','no-store').json({ok:false,code,message:websiteErrorMessage(code)});
 }
}
@Controller('integrations/website')
@UseGuards(WebsiteOrdersGuard)
@UseFilters(WebsiteOrdersExceptionFilter)
export class WebsiteOrdersController {
 constructor(@Inject(WebsiteOrdersService) private readonly orders:WebsiteOrdersService,
  @Inject(WEBSITE_ORDER_AUTHENTICATOR) private readonly authenticator:WebsiteOrderAuthenticator){}
 @Post('orders') @HttpCode(200) @Header('Cache-Control','no-store')
 async receive(@Body() body:unknown,@Req() request:Request){
  const principal=websiteOrderPrincipal(request);
  const {sourceAccount}=parseWebsiteOrder(body);
  await this.authenticator.authorizeSource(principal,sourceAccount);
  return this.orders.ingest(body,principal.kind==='key'?principal.sourceAccount:undefined);
 }
}
