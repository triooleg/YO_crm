import { Body,Controller,Get,Param,Patch,Post,Query,Req,Res,UseGuards } from "@nestjs/common";
import type { Request,Response } from "express";import type { User } from "@prisma/client";
import { Roles } from "../auth/roles.decorator";import { RolesGuard } from "../auth/roles.guard";import { SessionGuard } from "../auth/session.guard";
import { CreateExpenseCategoryDto,CreateExpenseDto,CreateInvoiceDto,UpdateInvoiceDto,UpdateSettingDto } from "./finance.dto";import { FinanceService } from "./finance.service";
@Controller("finance") @UseGuards(SessionGuard,RolesGuard) export class FinanceController{
 constructor(private readonly finance:FinanceService){}
 @Get() @Roles("OWNER","ADMIN","ACCOUNTANT") summary(@Query("month") month?:string){return this.finance.summary(month)}
 @Get("settings") @Roles("OWNER","ADMIN") settings(){return this.finance.settings()}
 @Patch("settings") @Roles("OWNER","ADMIN") saveSetting(@Body() dto:UpdateSettingDto,@Req() req:Request&{user:User}){return this.finance.saveSetting(dto,req.user)}
 @Post("expense-categories") @Roles("OWNER","ADMIN","ACCOUNTANT") category(@Body() dto:CreateExpenseCategoryDto,@Req() req:Request&{user:User}){return this.finance.createCategory(dto,req.user)}
 @Post("expenses") @Roles("OWNER","ADMIN","ACCOUNTANT") expense(@Body() dto:CreateExpenseDto,@Req() req:Request&{user:User}){return this.finance.createExpense(dto,req.user)}
 @Post("invoices") @Roles("OWNER","ADMIN","MANAGER","ACCOUNTANT") invoice(@Body() dto:CreateInvoiceDto,@Req() req:Request&{user:User}){return this.finance.createInvoice(dto,req.user)}
 @Patch("invoices/:id") @Roles("OWNER","ADMIN","MANAGER","ACCOUNTANT") updateInvoice(@Param("id") id:string,@Body() dto:UpdateInvoiceDto,@Req() req:Request&{user:User}){return this.finance.updateInvoice(id,dto,req.user)}
 @Get("invoices/:id/document") @Roles("OWNER","ADMIN","MANAGER","ACCOUNTANT") async document(@Param("id") id:string,@Query("download") download:string|undefined,@Res() res:Response){const html=await this.finance.document(id);if(download==="1")res.setHeader("Content-Disposition",'attachment; filename="invoice-'+id+'.html"');return res.type("html").send(html)}
}