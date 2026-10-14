import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEmail, IsEnum, IsInt, IsIn, IsOptional, IsPositive, IsString, Length, Max, MaxLength, Min, ValidateIf, ValidateNested } from "class-validator";
import { Transform, Type } from "class-transformer";
import { Discipline, OrderType, PaymentMethod, ProductionStatus, SalesStatus } from "@prisma/client";
import { CreateMeasurementDto } from "../clients/clients.dto";

export class UploadModelImageDto {
  @ApiProperty() @IsString() @Length(1, 150) name!: string;
  @ApiProperty() @IsString() mime!: string;
  @ApiProperty() @IsString() data!: string;
}

export class UploadOrderFileDto {
  @ApiProperty() @IsString() @Length(1, 180) name!: string;
  @ApiProperty() @IsString() @Length(1, 150) mimeType!: string;
  @ApiProperty() @IsString() data!: string;
}

export class ArchiveOrdersDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsString({ each: true })
  orderIds!: string[];
}

export class WebsiteSalesCorrectionCandidateDto {
  @ApiProperty() @IsString() orderId!: string;
  @ApiProperty() @IsDateString() expectedUpdatedAt!: string;
  @ApiProperty({ enum: OrderType }) @IsEnum(OrderType) expectedType!: OrderType;
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsDateString() expectedProductionSlotUpdatedAt!: string | null;
  @ApiProperty() @IsString() expectedSourceId!: string;
  @ApiProperty() @IsString() expectedSourceName!: string;
}

export class WebsiteSalesCorrectionDto {
  @ApiProperty() @IsBoolean() dryRun!: boolean;
  @ApiPropertyOptional({ type: [WebsiteSalesCorrectionCandidateDto] })
  @ValidateIf(value => !value.dryRun)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5000)
  @ValidateNested({ each: true })
  @Type(() => WebsiteSalesCorrectionCandidateDto)
  candidates?: WebsiteSalesCorrectionCandidateDto[];
}

export class DeleteProductionSlotDto {
  @ApiProperty() @IsDateString() expectedUpdatedAt!: string;
}

export class UpdateOrderModelImageDto {
  @ApiPropertyOptional() @IsOptional() @IsString() itemId?: string;
  @ApiProperty() @IsString() @Length(1, 150) modelImagePath!: string;
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() expectedModelImagePath!: string | null;
}

export class UpdateOrderItemDetailsDto {
  @ApiProperty() @IsString() @Length(1, 300) name!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) quantity!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(2_147_483_647) priceMinor!: number;
  @ApiProperty() @IsString() @Length(1, 300) expectedName!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) expectedQuantity!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(2_147_483_647) expectedPriceMinor!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 150) modelImagePath?: string;
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() expectedModelImagePath!: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(2_147_483_647) designNumber?: number | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((input, value) => input.designNumber !== undefined && value !== null) @IsInt() @Min(1) @Max(2_147_483_647) expectedDesignNumber?: number | null;
}

export class AddOrderItemDto {
  @ApiProperty() @IsString() @Length(1, 300) name!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) quantity!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(2_147_483_647) priceMinor!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 150) modelImagePath?: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((_, value) => value !== null) @IsInt() @Min(1) @Max(2_147_483_647) designNumber?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() athleteId?: string;
}

export class BindOrderItemMeasurementDto {
  @ApiProperty() @IsString() measurementId!: string;
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() expectedMeasurementId!: string | null;
}

export class UpdateOrderDetailsDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @IsIn(["EUR", "USD", "UAH"]) currency?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @IsIn(["EUR", "USD", "UAH"]) expectedCurrency?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() priceDirty?: boolean;
  @ApiPropertyOptional({ enum: OrderType }) @IsOptional() @IsEnum(OrderType) type?: OrderType;
  @ApiPropertyOptional({ enum: OrderType }) @IsOptional() @IsEnum(OrderType) expectedType?: OrderType;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, value) => value !== undefined && value !== null) @IsDateString() requiredDeliveryAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, value) => value !== undefined && value !== null) @IsDateString() expectedRequiredDeliveryAt?: string | null;
  @ApiProperty() @IsString() @Length(1, 300) description!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(2_147_483_647) priceMinor!: number;
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() expectedDescription!: string | null;
  @ApiProperty() @IsInt() @Min(0) @Max(2_147_483_647) expectedPriceMinor!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 150) modelImagePath?: string;
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() expectedModelImagePath!: string | null;
}

export class CreateOrderItemDto {
  @ApiPropertyOptional() @IsOptional() @IsString() athleteId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() measurementId?: string;
  @ApiProperty() @IsString() @Length(1, 160) name!: string;
  @ApiProperty() @IsInt() @Min(1) quantity!: number;
  @ApiProperty() @IsInt() @Min(0) priceMinor!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() modelImagePath?: string;
}

export class CreateOrderDto {
  @ApiProperty() @IsString() clientId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() athleteId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() measurementId?: string;
  @ApiProperty({ enum: OrderType }) @IsEnum(OrderType) type!: OrderType;
  @ApiProperty() @IsString() @Length(1, 300) description!: string;
  @ApiProperty() @IsString() modelImagePath!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() requiredDeliveryAt?: string;
  @ApiProperty() @IsInt() @Min(0) priceMinor!: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) depositRequiredMinor?: number;
  @ApiProperty() @IsString() @IsIn(["EUR", "USD", "UAH"]) currency!: string;
  @ApiPropertyOptional({ type: [CreateOrderItemDto] }) @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => CreateOrderItemDto) items?: CreateOrderItemDto[];
}

export class AddOrderPaymentDto {
  @ApiProperty() @IsInt() @IsPositive() amountMinor!: number;
  @ApiProperty() @IsString() @IsIn(["EUR", "USD", "UAH"]) currency!: string;

  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) method!: PaymentMethod;
  @ApiProperty() @IsDateString() receivedAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 120) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) notes?: string;
}
export class UpdateOrderStatusesDto {
  @ApiPropertyOptional({ enum: SalesStatus }) @IsOptional() @IsEnum(SalesStatus) salesStatus?: SalesStatus;
  @ApiPropertyOptional({ enum: ProductionStatus }) @IsOptional() @IsEnum(ProductionStatus) productionStatus?: ProductionStatus;
}
export class UpdateProductionSlotDto {
 @ApiProperty() @IsDateString() startsAt!: string;
 @ApiProperty() @IsDateString() endsAt!: string;
 @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) capacity?: number;
 @ApiPropertyOptional() @IsOptional() @IsBoolean() tentative?: boolean;
 @ApiPropertyOptional() @IsOptional() @IsBoolean() locked?: boolean;
}
export class UpdateOrderDeadlineDto {
 @ApiProperty() @IsDateString() requiredDeliveryAt!: string;
}
export class UpdateOrderCurrencyDto {
 @ApiProperty({ enum: ["EUR", "USD", "UAH"] }) @IsString() @IsIn(["EUR", "USD", "UAH"]) currency!: "EUR" | "USD" | "UAH";
}
export class UpdateOrderDisciplineDto {
 @ApiProperty({ enum: Discipline }) @IsEnum(Discipline) discipline!: Discipline;
}
export class UpdateOrderBuyerCommentDto {
 @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(5000) buyerComment!: string | null;
 @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(5000) expectedBuyerComment!: string | null;
}
export class UpdateOrderDeliveryContactDto {
 @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(80) recipientPhone!: string | null;
 @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsEmail({}, { message: "Введите корректный e-mail" }) @MaxLength(320) email!: string | null;
 @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() @MaxLength(80) expectedRecipientPhone!: string | null;
 @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsEmail({}, { message: "Введите корректный e-mail" }) @MaxLength(320) expectedEmail!: string | null;
}
export class UpdateOrderDeliveryAddressDto {
  @ApiProperty() @IsBoolean() useClientAddress!: boolean;
  @ApiProperty() @IsBoolean() recipientMatchesClient!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 160) recipient?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 240) addressLine1?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 240) addressLine2?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 120) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 120) region?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 32) postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 120) country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 800) addressText?: string;
}
export class VoidOrderPaymentDto {
  @ApiProperty() @Transform(({ value }) => typeof value === "string" ? value.trim() : value) @IsString() @Length(2, 500) reason!: string;
  @ApiProperty() @IsDateString() expectedOrderUpdatedAt!: string;
}

export class OrderMeasurementDto extends CreateMeasurementDto {
  @ApiPropertyOptional() @IsOptional() @IsString() expectedMeasurementId?: string;
}
