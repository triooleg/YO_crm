import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min, ValidateIf } from "class-validator";
import { OrderType } from "@prisma/client";

export class UpdateKeycrmSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(20, 500) apiToken?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() removeApiToken?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(50) pageSize?: number;
  @ApiPropertyOptional({ enum: ["EUR", "USD", "UAH"] }) @IsOptional() @IsString() @Length(3, 3) @IsIn(["EUR", "USD", "UAH"]) defaultCurrency?: string;
  @ApiPropertyOptional({ enum: OrderType }) @IsOptional() @IsEnum(OrderType) defaultOrderType?: OrderType;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) productionStartFieldUuid?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) expectedDeliveryFieldUuid?: string;
}

export class CreateKeycrmSyncRunDto {
  @ApiProperty() @IsBoolean() dryRun!: boolean;
  @ApiProperty() @IsUUID() clientRequestId!: string;
  @ApiPropertyOptional({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER, description: "Числовой ID карточки заказа KeyCRM" })
  @ValidateIf((_object, value) => value !== undefined) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) orderId?: number;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() previewRunId?: string;
}
