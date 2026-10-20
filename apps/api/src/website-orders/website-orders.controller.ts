import { ArgumentsHost, Body, Catch, Controller, ExceptionFilter, Header, HttpCode, Inject, Post, UseFilters, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { WebsiteOrdersService } from './website-orders.service';
import { WebsiteOrdersGuard } from './website-orders-security';
import { WebsiteOrderError, websiteErrorMessage } from './website-orders-errors';

@Catch()
export class WebsiteOrdersExceptionFilter implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost){
  const known=error instanceof WebsiteOrderError;
  const conflict=!!error&&typeof error==='object'&&'code' in error&&['P2002','P2034'].includes(String(error.code));
  const code=known?error.code:conflict?'WEBSITE_ORDER_CONFLICT':'WEBSITE_ORDER_FAILED';
  host.switchToHttp().getResponse<Response>().status(known?error.status:conflict?409:500).setHeader('Cache-Control','no-store').json({ok:false,code,message:websiteErrorMessage(code)});
 }
}
@Controller('integrations/website')
@UseGuards(WebsiteOrdersGuard)
@UseFilters(WebsiteOrdersExceptionFilter)
export class WebsiteOrdersController {
 constructor(@Inject(WebsiteOrdersService) private readonly orders:WebsiteOrdersService){}
 @Post('orders') @HttpCode(200) @Header('Cache-Control','no-store')
 receive(@Body() body:unknown){return this.orders.ingest(body);}
}
