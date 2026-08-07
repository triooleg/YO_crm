import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsEnum, IsInt, IsOptional, IsPositive, IsString, Length, Min } from "class-validator";
import { OrderType, PaymentMethod } from "@prisma/client";

export class UploadModelImageDto {
  @ApiProperty() @IsString() @Length(1, 150) name!: string;
  @ApiProperty() @IsString() mime!: string;
  @ApiProperty() @IsString() data!: string;
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
  @ApiProperty() @IsString() @Length(3, 3) currency!: string;
}

export class AddOrderPaymentDto {
  @ApiProperty() @IsInt() @IsPositive() amountMinor!: number;
  @ApiProperty() @IsString() @Length(3, 3) currency!: string;
  @ApiProperty({ enum: PaymentMethod }) @IsEnum(PaymentMethod) method!: PaymentMethod;
  @ApiProperty() @IsDateString() receivedAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 120) reference?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 300) notes?: string;
}
