import { Body, Controller, Get, Header, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { User } from '@prisma/client';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SessionGuard } from '../auth/session.guard';
import { TaxesService } from './taxes.service';
import { TaxAllocationDto, TaxBackfillApplyDto, TaxBackfillPreviewDto, TaxCloseDto, TaxCommandDto, TaxConfirmSourceDto, TaxCorrectionDto, TaxExemptionDto, TaxPolicyDto, TaxPolicyPreviewDto, TaxReasonDto, TaxReportDto, TaxSettingsDto, TaxSettlementCorrectionDto, TaxSettlementDto } from './taxes.dto';
type AuthRequest=Request&{user:User};
@Controller('finance/taxes') @UseGuards(SessionGuard,RolesGuard) @Roles('OWNER','ADMIN','ACCOUNTANT')
export class TaxesController {
 constructor(private readonly taxes:TaxesService){}
 @Header('Cache-Control','no-store') @Get('settings') settings(@Req() req:AuthRequest){return this.taxes.settings(req.user);}
 @Header('Cache-Control','no-store') @Post('settings') @Roles('OWNER','ADMIN') saveSettings(@Body() d:TaxSettingsDto,@Req() req:AuthRequest){return this.taxes.saveSettings(d,req.user);}
 @Header('Cache-Control','no-store') @Post('policies') @Roles('OWNER','ADMIN') policy(@Body() d:TaxPolicyDto,@Req() req:AuthRequest){return this.taxes.publishPolicy(d,req.user);}
 @Header('Cache-Control','no-store') @Post('policies/preview') @Roles('OWNER','ADMIN') policyPreview(@Body() d:TaxPolicyPreviewDto,@Req() req:AuthRequest){return this.taxes.policyPreview(d,req.user);}
 @Header('Cache-Control','no-store') @Get('report') report(@Query() d:TaxReportDto,@Req() req:AuthRequest){return this.taxes.report(d,req.user);}
 @Header('Cache-Control','no-store') @Get('report/export') async exportReport(@Query() d:TaxReportDto,@Req() req:AuthRequest,@Res() res:Response){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','text/csv; charset=utf-8');res.setHeader('Content-Disposition','attachment; filename="fop-taxes.csv"');return res.send(await this.taxes.reportCsv(d,req.user));}
 @Header('Cache-Control','no-store') @Get('orders/:id') order(@Param('id') id:string,@Req() req:AuthRequest){return this.taxes.order(id,req.user);}
 @Header('Cache-Control','no-store') @Post('backfill/preview') @Roles('OWNER','ADMIN') preview(@Body() d:TaxBackfillPreviewDto,@Req() req:AuthRequest){return this.taxes.backfillPreview(d,req.user);}
 @Header('Cache-Control','no-store') @Post('backfill/apply') @Roles('OWNER','ADMIN') apply(@Body() d:TaxBackfillApplyDto,@Req() req:AuthRequest){return this.taxes.backfillApply(d,req.user);}
 @Header('Cache-Control','no-store') @Post('sources/:id/confirm') confirm(@Param('id') id:string,@Body() d:TaxConfirmSourceDto,@Req() req:AuthRequest){return this.taxes.confirmSource(id,d,req.user);}
 @Header('Cache-Control','no-store') @Post('settlements') settle(@Body() d:TaxSettlementDto,@Req() req:AuthRequest){return this.taxes.settle(d,req.user);}
 @Header('Cache-Control','no-store') @Post('allocations') allocate(@Body() d:TaxAllocationDto,@Req() req:AuthRequest){return this.taxes.allocate(d,req.user);}
 @Header('Cache-Control','no-store') @Post('allocations/:id/reverse') reverse(@Param('id') id:string,@Body() d:TaxReasonDto,@Req() req:AuthRequest){return this.taxes.reverseAllocation(id,d,req.user);}
 @Header('Cache-Control','no-store') @Post('settlements/:id/correct') correctSettlement(@Param('id') id:string,@Body() d:TaxSettlementCorrectionDto,@Req() req:AuthRequest){return this.taxes.correctSettlement(id,d,req.user);}
 @Header('Cache-Control','no-store') @Post('corrections') correction(@Body() d:TaxCorrectionDto,@Req() req:AuthRequest){return this.taxes.draftCorrection(d,req.user);}
 @Header('Cache-Control','no-store') @Post('corrections/:id/publish') publish(@Param('id') id:string,@Body() d:TaxCommandDto,@Req() req:AuthRequest){return this.taxes.publishCorrection(id,d,req.user);}
 @Header('Cache-Control','no-store') @Post('periods/:month/close') @Roles('OWNER','ADMIN') close(@Param('month') month:string,@Body() d:TaxCloseDto,@Req() req:AuthRequest){return this.taxes.closePeriod(month,d,req.user);}
 @Header('Cache-Control','no-store') @Post('periods/:month/exemption') @Roles('OWNER','ADMIN') exemption(@Param('month') month:string,@Body() d:TaxExemptionDto,@Req() req:AuthRequest){return this.taxes.exemption(month,d,req.user);}
}
