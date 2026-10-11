import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from "class-validator";
import { OrderType } from "@prisma/client";

export class UpdateKeycrmSettingsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() enabled?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(20, 500) apiToken?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() removeApiToken?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(50) pageSize?: number;
  @ApiPropertyOptional({ enum: ["EUR", "USD", "UAH"] }) @IsOptional() @IsString() @Length(3, 3) @IsIn(["EUR", "USD", "UAH"]) defaultCurrency?: string;
  @ApiPropertyOptional({ enum: OrderType }) @IsOptional() @IsEnum(OrderType) defaultOrderType?: OrderType;
}

export class CreateKeycrmSyncRunDto {
  @ApiProperty() @IsBoolean() dryRun!: boolean;
  @ApiProperty() @IsUUID() clientRequestId!: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() from?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() to?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() previewRunId?: string;
}
