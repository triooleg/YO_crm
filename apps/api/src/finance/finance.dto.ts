import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { Allow, ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsDefined, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsPositive, IsString, Length, Max, MaxLength, Min, ValidateIf, ValidateNested } from "class-validator";
import { InvoiceStatus, OrderDocumentKind } from "@prisma/client";
const CURRENCIES=["EUR","USD","UAH"] as const;
export class InvoicePreviewMetadataDto {
 @IsOptional() @IsDateString() issueDate?:string;
 @IsOptional() @IsDateString() dueDate?:string;
 @IsOptional() @IsString() @MaxLength(2000) notes?:string;
 @IsOptional() @IsBoolean() showLogo?:boolean;
}
export class InvoicePreviewDto {
 @IsString() @Length(1,120) orderId!:string;
 @IsString() @Length(1,120) templateKey!:string;
 @IsOptional() @IsString() @Length(1,120) sourceInvoiceId?:string;
 @IsOptional() @IsObject() @ValidateNested() @Type(()=>InvoicePreviewMetadataDto) metadata?:InvoicePreviewMetadataDto;
}
export class InvoiceFromTemplateDto {
 @IsString() @Length(1,120) previewToken!:string;
 @IsString() @Length(1,120) idempotencyKey!:string;
}
export class TemplateRevisionDto { @IsOptional() @IsInt() @Min(1) expectedRevision?:number; }
export class DocumentAppearanceDto {
 @IsOptional() @IsString() @MaxLength(80) logoText?:string;
 @IsOptional() @IsString() @Length(7,7) accentColor?:string;
 @IsOptional() @IsString() @Length(7,7) mutedColor?:string;
 @IsOptional() @IsInt() @Min(8) @Max(12) fontSize?:number;
}
export class CreateExpenseCategoryDto { @ApiProperty() @IsString() @Length(1,80) name!:string; }
export class CreateExpenseDto { @ApiProperty() @IsString() categoryId!:string; @ApiPropertyOptional() @IsOptional() @IsString() orderId?:string; @ApiProperty() @IsInt() @IsPositive() amountMinor!:number; @ApiProperty() @IsString() @IsIn(CURRENCIES) currency!:string; @ApiProperty() @IsDateString() incurredAt!:string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,300) notes?:string; }
export class InvoiceItemDto { @ApiProperty() @IsString() @Length(1,300) description!:string; @ApiProperty() @IsInt() @Min(1) quantity!:number; @ApiProperty() @IsInt() @IsPositive() amountMinor!:number; @ApiPropertyOptional({type:[String]}) @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({each:true}) @MaxLength(200,{each:true}) properties?:string[]; }
export class InvoicePartyDto { @ApiProperty() @IsString() @Length(1,160) name!:string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,500) address?:string; }
export class DocumentPaymentDetailsDto { @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,160) receiver?:string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,100) iban?:string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,100) bic?:string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,2000) instructions?:string; }
export class DocumentTemplateConfigDto {
 @IsOptional() @IsInt() @IsIn([1]) version?:number;
 @IsOptional() @IsIn(CURRENCIES) currency?:string|null;
 @IsOptional() @IsString() @MaxLength(160) purpose?:string;
 @IsOptional() @IsBoolean() isDefault?:boolean;
 @IsOptional() @IsInt() @Min(1) revision?:number;
 @IsOptional() @IsArray() @ArrayMaxSize(4) @IsIn(["issueDate","dueDate","notes","showLogo"],{each:true}) editableMetadata?:string[];
 @IsOptional() @IsString() @MaxLength(2000) notes?:string;
 @IsOptional() @IsString() @MaxLength(2000) footer?:string;
 @IsOptional() @IsArray() @ArrayMaxSize(5) @IsIn(["seller.name","seller.address","customer.name","customer.address","order.items.name"],{each:true}) requiredFields?:string[];
 @IsOptional() @IsObject() @ValidateNested() @Type(()=>DocumentAppearanceDto) appearance?:DocumentAppearanceDto;
 @IsOptional() @IsObject() labels?:Record<string,string>;
 @ApiProperty() @IsString() @Length(1,160) title!:string; @ApiProperty({type:[String]}) @IsArray() @ArrayMinSize(1) @IsString({each:true}) fieldKeys!:string[]; @ApiPropertyOptional() @IsOptional() @IsBoolean() showLogo?:boolean; @ApiPropertyOptional({type:InvoicePartyDto}) @IsOptional() @ValidateNested() @Type(()=>InvoicePartyDto) seller?:InvoicePartyDto; @ApiPropertyOptional({type:DocumentPaymentDetailsDto}) @IsOptional() @ValidateNested() @Type(()=>DocumentPaymentDetailsDto) payment?:DocumentPaymentDetailsDto; }
export class CreateDocumentTemplateDto { @ApiProperty() @IsString() @Length(1,120) name!:string; @ApiProperty({enum:OrderDocumentKind}) @IsEnum(OrderDocumentKind) kind!:OrderDocumentKind; @ApiProperty() @IsString() @IsIn(["ru","uk","en","fr"]) language!:string; @ApiProperty({type:DocumentTemplateConfigDto}) @IsObject() @Type(()=>DocumentTemplateConfigDto) config!:DocumentTemplateConfigDto; }
export class UpdateDocumentTemplateDto extends TemplateRevisionDto { @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,120) name?:string; @ApiPropertyOptional() @IsOptional() @IsBoolean() active?:boolean; @ApiPropertyOptional() @IsOptional() @IsString() @IsIn(["ru","uk","en","fr"]) language?:string; @ApiPropertyOptional({type:DocumentTemplateConfigDto}) @IsOptional() @IsObject() @Type(()=>DocumentTemplateConfigDto) config?:DocumentTemplateConfigDto; }
export class OrderDocumentSelectionDto { @ApiProperty() @IsString() orderId!:string; @ApiProperty() @IsString() templateKey!:string; @ApiPropertyOptional({type:[String]}) @IsOptional() @IsArray() @IsString({each:true}) fieldKeys?:string[]; @ApiPropertyOptional() @IsOptional() @IsString() @IsIn(["ru","uk","en","fr"]) language?:string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,160) title?:string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,160) documentTitle?:string; @ApiPropertyOptional({type:InvoicePartyDto}) @IsOptional() @ValidateNested() @Type(()=>InvoicePartyDto) seller?:InvoicePartyDto; @ApiPropertyOptional({type:InvoicePartyDto}) @IsOptional() @ValidateNested() @Type(()=>InvoicePartyDto) customer?:InvoicePartyDto; @ApiPropertyOptional({type:DocumentPaymentDetailsDto}) @IsOptional() @ValidateNested() @Type(()=>DocumentPaymentDetailsDto) payment?:DocumentPaymentDetailsDto; @ApiPropertyOptional() @IsOptional() @IsBoolean() showLogo?:boolean; @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,2000) notes?:string; }
export class CreateOrderDocumentDto extends OrderDocumentSelectionDto { @ApiPropertyOptional() @IsOptional() @IsDateString() issueDate?:string; @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?:string; }
export class PreviewOrderDocumentDto extends OrderDocumentSelectionDto { @ApiPropertyOptional() @IsOptional() @IsDateString() issueDate?:string; @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?:string; @ApiPropertyOptional({type:[InvoiceItemDto]}) @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>InvoiceItemDto) items?:InvoiceItemDto[]; }
export class CreateInvoiceDto {
  @ApiProperty() @IsString() orderId!: string;
  @ApiProperty() @IsString() @Length(1, 20) language!: string;
  @ApiProperty() @IsDateString() issueDate!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() dueDate?: string;
  @ApiProperty({ type: InvoicePartyDto }) @IsObject() @ValidateNested() @Type(() => InvoicePartyDto) seller!: InvoicePartyDto;
  @ApiProperty({ type: InvoicePartyDto }) @IsObject() @ValidateNested() @Type(() => InvoicePartyDto) customer!: InvoicePartyDto;
  @ApiProperty({ type: [InvoiceItemDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) items!: InvoiceItemDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 1000) notes?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() templateKey?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) fieldKeys?: string[];
  @ApiPropertyOptional({ type: DocumentPaymentDetailsDto }) @IsOptional() @ValidateNested() @Type(() => DocumentPaymentDetailsDto) payment?: DocumentPaymentDetailsDto;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showLogo?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 160) documentTitle?: string;
}
export class UpdateInvoiceDto { @ApiPropertyOptional({enum:InvoiceStatus}) @IsOptional() @IsEnum(InvoiceStatus) status?:InvoiceStatus; @ApiPropertyOptional() @IsOptional() @IsString() language?:string; @ApiPropertyOptional({nullable:true}) @IsOptional() @ValidateIf((_,value)=>value!==null) @IsDateString() dueDate?:string|null; @ApiPropertyOptional({type:InvoicePartyDto}) @IsOptional() @ValidateNested() @Type(()=>InvoicePartyDto) seller?:InvoicePartyDto; @ApiPropertyOptional({type:InvoicePartyDto}) @IsOptional() @ValidateNested() @Type(()=>InvoicePartyDto) customer?:InvoicePartyDto; @ApiPropertyOptional({type:[InvoiceItemDto]}) @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({each:true}) @Type(()=>InvoiceItemDto) items?:InvoiceItemDto[]; @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,1000) notes?:string; }
export class UpdateSettingDto { @ApiProperty() @IsString() @IsIn(["finance","orders"]) section!:string; @ApiProperty() @IsString() @IsIn(["invoicePrefix","sellerName","sellerAddress","defaultCurrency","depositPercent"]) key!:string; @ApiProperty() @IsDefined() @Allow() value!:unknown; }
export class UpdateProductionSettingsDto { @ApiProperty() @Type(()=>Number) @IsInt() @Min(1) @Max(90) defaultDurationDays!:number; @ApiProperty() @Type(()=>Number) @IsInt() @Min(0) @Max(30) shippingLeadDays!:number; }
export class UpdateExchangeRateProviderDto { @ApiProperty({enum:["ECB","NBU"]}) @IsString() @IsIn(["ECB","NBU"]) provider!:"ECB"|"NBU"; }
export class UpdateExpenseDto { @ApiPropertyOptional() @IsOptional() @IsString() categoryId?:string; @ApiPropertyOptional() @IsOptional() @IsString() orderId?:string|null; @ApiPropertyOptional() @IsOptional() @IsInt() @IsPositive() amountMinor?:number; @ApiPropertyOptional() @IsOptional() @IsString() @IsIn(CURRENCIES) currency?:string; @ApiPropertyOptional() @IsOptional() @IsDateString() incurredAt?:string; @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,300) notes?:string|null; }
export class UpdateExpenseCategoryDto { @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,80) name?:string; @ApiPropertyOptional() @IsOptional() @IsBoolean() active?:boolean; }

export class ValidateDocumentTemplateDto {
 @IsString() @IsIn(["ru","uk","en","fr"]) language!:string;
 @IsObject() @Type(()=>DocumentTemplateConfigDto) config!:DocumentTemplateConfigDto;
}
export class PreviewDocumentTemplateDto extends ValidateDocumentTemplateDto {
 @IsOptional() @IsEnum(OrderDocumentKind) kind?:OrderDocumentKind;
 @IsString() @Length(1,120) orderId!:string;
}
