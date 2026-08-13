import { Body,Controller,Delete,Get,Param,Patch,Post,Query,Req,Res,UseGuards } from "@nestjs/common";
import type { Request,Response } from "express";import type { User } from "@prisma/client";
import { Roles } from "../auth/roles.decorator";import { RolesGuard } from "../auth/roles.guard";import { SessionGuard } from "../auth/session.guard";
import { CreateExpenseCategoryDto,CreateExpenseDto,UpdateExpenseCategoryDto,UpdateExpenseDto,CreateInvoiceDto,UpdateInvoiceDto,UpdateSettingDto } from "./finance.dto";import { FinanceService } from "./finance.service";
@Controller("finance") @UseGuards(SessionGuard,RolesGuard) export class FinanceController{
 constructor(private readonly finance:FinanceService){}
 @Get() @Roles("OWNER","ADMIN","ACCOUNTANT") summary(@Query("month") month?:string){return this.finance.summary(month)}
 @Get("settings") @Roles("OWNER","ADMIN") settings(){return this.finance.settings()}
 @Patch("settings") @Roles("OWNER","ADMIN") saveSetting(@Body() dto:UpdateSettingDto,@Req() req:Request&{user:User}){return this.finance.saveSetting(dto,req.user)}
 @Post("expense-categories") @Roles("OWNER","ADMIN","ACCOUNTANT") category(@Body() dto:CreateExpenseCategoryDto,@Req() req:Request&{user:User}){return this.finance.createCategory(dto,req.user)}
 @Post("expenses") @Roles("OWNER","ADMIN","ACCOUNTANT") expense(@Body() dto:CreateExpenseDto,@Req() req:Request&{user:User}){return this.finance.createExpense(dto,req.user)}
 @Patch("expense-categories/:id") @Roles("OWNER","ADMIN","ACCOUNTANT") updateCategory(@Param("id") id:string,@Body() dto:UpdateExpenseCategoryDto,@Req() req:Request&{user:User}){return this.finance.updateCategory(id,dto,req.user)}
 @Patch("expenses/:id") @Roles("OWNER","ADMIN","ACCOUNTANT") updateExpense(@Param("id") id:string,@Body() dto:UpdateExpenseDto,@Req() req:Request&{user:User}){return this.finance.updateExpense(id,dto,req.user)}
 @Delete("expenses/:id") @Roles("OWNER","ADMIN","ACCOUNTANT") archiveExpense(@Param("id") id:string,@Req() req:Request&{user:User}){return this.finance.archiveExpense(id,req.user)}
 @Post("invoices") @Roles("OWNER","ADMIN","MANAGER","ACCOUNTANT") invoice(@Body() dto:CreateInvoiceDto,@Req() req:Request&{user:User}){return this.finance.createInvoice(dto,req.user)}
 @Patch("invoices/:id") @Roles("OWNER","ADMIN","ACCOUNTANT") updateInvoice(@Param("id") id:string,@Body() dto:UpdateInvoiceDto,@Req() req:Request&{user:User}){return this.finance.updateInvoice(id,dto,req.user)}
 @Get("invoices/:id/document") @Roles("OWNER","ADMIN","MANAGER","ACCOUNTANT") async document(@Param("id") id:string,@Query("download") download:string|undefined,@Query("print") _print:string|undefined,@Res() res:Response){const document=await this.finance.document(id),filename="invoice-"+document.number.replace(/[^A-Za-z0-9_-]/g,"-")+".pdf",disposition=download==="1"?"attachment":"inline";res.setHeader("Content-Type","application/pdf");res.setHeader("Content-Disposition",`${disposition}; filename="${filename}"`);res.setHeader("Content-Length",String(document.pdf.length));return res.send(document.pdf)}
}
