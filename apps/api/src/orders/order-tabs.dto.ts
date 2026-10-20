import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { OrderFileRole, OrderNoteCategory, OrderNoteVisibility, ProductionStatus } from "@prisma/client";
import { IsBoolean, IsDateString, IsEnum, IsObject, IsOptional, IsString, Length, MaxLength, ValidateIf } from "class-validator";
import { CreateMeasurementDto } from "../clients/clients.dto";

export class CreateInstanceMeasurementDto extends CreateMeasurementDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmProduction?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,2000) reason?: string;
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() @Length(1,100) expectedMeasurementId!: string | null;
  @ApiProperty() @IsDateString() expectedUpdatedAt!: string;
}

export class CreateOrderNoteDto {
  @ApiProperty({ enum: OrderNoteCategory }) @IsEnum(OrderNoteCategory) category!: OrderNoteCategory;
  @ApiProperty({ enum: OrderNoteVisibility }) @IsEnum(OrderNoteVisibility) visibility!: OrderNoteVisibility;
  @ApiPropertyOptional() @IsOptional() @IsString() designItemId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() itemInstanceId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() athleteId?: string;
  @ApiProperty() @IsString() @Length(1, 160) title!: string;
  @ApiProperty() @IsString() @Length(1, 10000) body!: string;
}
export class UpdateOrderNoteDto extends CreateOrderNoteDto { @ApiProperty() @IsDateString() expectedUpdatedAt!: string; }
export class CreateOrderTagDto { @ApiProperty() @IsString() @Length(1, 48) label!: string; @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(24) color?: string; }
export class UpdateOrderItemInstanceDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmProduction?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,2000) reason?: string;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, value) => value !== undefined && value !== null) @IsString() athleteId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, value) => value !== undefined && value !== null) @IsString() measurementId?: string | null;
  @ApiPropertyOptional({ enum: ProductionStatus }) @IsOptional() @IsEnum(ProductionStatus) productionStatus?: ProductionStatus;
  @ApiProperty() @IsDateString() expectedUpdatedAt!: string;
}
export class UpdateOrderFileRoleDto {
  @ApiProperty({ enum: OrderFileRole }) @IsEnum(OrderFileRole) role!: OrderFileRole;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, value) => value !== undefined && value !== null) @IsString() orderItemId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, value) => value !== undefined && value !== null) @IsString() noteId?: string | null;
  @ApiProperty({ enum: OrderFileRole }) @IsEnum(OrderFileRole) expectedRole!: OrderFileRole;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, value) => value !== undefined && value !== null) @IsString() expectedOrderItemId?: string | null;
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, value) => value !== undefined && value !== null) @IsString() expectedNoteId?: string | null;
}
export class UpdateClientPreferencesDto { @ApiProperty() @IsObject() preferences!: Record<string, unknown>; @ApiProperty() @IsDateString() expectedUpdatedAt!: string; }
export class UploadClientFileDto {
  @ApiProperty() @IsString() @Length(1,180) name!: string;
  @ApiProperty() @IsString() @Length(1,150) mimeType!: string;
  @ApiProperty() @IsString() data!: string;
}
