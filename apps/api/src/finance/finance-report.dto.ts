import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { ORDER_SOURCES } from "../orders/order-source";

/** Additive read contract. Mutations continue using the existing finance/order DTOs. */
export class FinanceReportQueryDto {
  @IsOptional() @IsIn(['ALL',...ORDER_SOURCES,'NON_WEBSITE']) source?:string;
  @IsOptional() @IsString() @MaxLength(7) month?: string;
  @IsOptional() @IsIn(["EUR", "USD", "UAH"]) currency?: string;
  @IsOptional() @Type(() => Number) @IsIn([3, 6, 12]) range?: number;
  @IsOptional() @IsIn(["payments", "expenses", "invoices", "taxes"]) tab?: string;
  @IsOptional() @IsIn(['UNIFIED', 'MILITARY', 'ESV']) taxComponent?: 'UNIFIED' | 'MILITARY' | 'ESV';
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100000) page?: number;
  @IsOptional() @Type(() => Number) @IsIn([10, 25, 50, 100]) pageSize?: number;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @MaxLength(30) status?: string;
  @IsOptional() @IsString() @MaxLength(128) clientId?: string;
  @IsOptional() @IsString() @MaxLength(128) categoryId?: string;
  @IsOptional() @IsString() @MaxLength(128) orderId?: string;
  @IsOptional() @IsString() @MaxLength(10) from?: string;
  @IsOptional() @IsString() @MaxLength(10) to?: string;
  @IsOptional() @IsIn(["date", "number", "client", "amount", "paid", "balance", "category", "status"]) sort?: string;
  @IsOptional() @IsIn(["asc", "desc"]) direction?: string;
  @IsOptional() @IsIn(["all", "forecast"]) scope?: string;
  @IsOptional() @IsString() @MaxLength(128) valuationVersion?: string;
}
