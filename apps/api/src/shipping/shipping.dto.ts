import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ShippingCarrier, ShippingStatus } from "@prisma/client";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from "class-validator";
export class UpsertShipmentDto {
  @ApiProperty({ enum: ShippingCarrier }) @IsEnum(ShippingCarrier) carrier!: ShippingCarrier;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @Length(1, 120) trackingNumber?: string | null;
  @ApiProperty() @IsInt() @Min(0) @Max(100000000) costMinor!: number;
  @ApiProperty() @IsIn(["EUR","USD","UAH"]) currency!: string;
  @ApiProperty({ enum: ShippingStatus }) @IsEnum(ShippingStatus) status!: ShippingStatus;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() shippedAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() deliveredAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @Length(0,500) notes?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}
export class UpdateCarrierSettingDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,120) account?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,160) sender?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,160) dispatchPoint?: string;
}
export class UpsertOrderShipmentDto {
  @ApiProperty({ enum: ShippingCarrier }) @IsEnum(ShippingCarrier) carrier!: ShippingCarrier;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @Length(1,120) trackingNumber?: string|null;
  @ApiProperty() @IsInt() @Min(0) @Max(100000000) customerChargeMinor!: number;
  @ApiProperty() @IsInt() @Min(0) @Max(100000000) atelierCostMinor!: number;
  @ApiPropertyOptional({ enum: ["EUR","USD","UAH"] }) @ValidateIf((_, value) => value !== undefined) @IsIn(["EUR","USD","UAH"]) customerChargeCurrency?: string;
  @ApiPropertyOptional({ enum: ["EUR","USD","UAH"] }) @ValidateIf((_, value) => value !== undefined) @IsIn(["EUR","USD","UAH"]) atelierCostCurrency?: string;
  @ApiProperty() @IsIn(["EUR","USD","UAH"]) currency!: string;
  @ApiProperty({ enum: ShippingStatus }) @IsEnum(ShippingStatus) status!: ShippingStatus;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() shippedAt?: string|null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() deliveredAt?: string|null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(100000) weightGrams?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10000) lengthMm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10000) widthMm?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(10000) heightMm?: number;
  @ApiProperty() @IsArray() @ArrayMaxSize(100) @IsString({each:true}) instanceIds!: string[];
  @ApiPropertyOptional() @IsOptional() @IsDateString() expectedUpdatedAt?: string;
}
export class ArchiveOrderShipmentDto { @ApiProperty() @IsDateString() expectedUpdatedAt!: string; }
