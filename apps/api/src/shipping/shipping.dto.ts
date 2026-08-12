import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ShippingCarrier, ShippingStatus } from "@prisma/client";
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from "class-validator";
export class UpsertShipmentDto {
  @ApiProperty({ enum: ShippingCarrier }) @IsEnum(ShippingCarrier) carrier!: ShippingCarrier;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @Length(1, 120) trackingNumber?: string | null;
  @ApiProperty() @IsInt() @Min(0) @Max(100000000) costMinor!: number;
  @ApiProperty() @IsIn(["EUR","USD","UAH"]) currency!: string;
  @ApiProperty({ enum: ShippingStatus }) @IsEnum(ShippingStatus) status!: ShippingStatus;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() shippedAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsDateString() deliveredAt?: string | null;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsString() @Length(0,500) notes?: string | null;
}
export class UpdateCarrierSettingDto {
  @ApiProperty() @IsBoolean() enabled!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,120) account?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,160) sender?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,160) dispatchPoint?: string;
}
