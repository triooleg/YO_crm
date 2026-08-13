import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsIn, IsOptional, IsPositive, IsString, Length, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";
import { OrderType, PaymentMethod, ProductionStatus, SalesStatus } from "@prisma/client";

export class UploadModelImageDto {
  @ApiProperty() @IsString() @Length(1, 150) name!: string;
  @ApiProperty() @IsString() mime!: string;
  @ApiProperty() @IsString() data!: string;
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
  @ApiProperty() @IsInt() @Min(0) depositRequiredMinor!: number;
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
