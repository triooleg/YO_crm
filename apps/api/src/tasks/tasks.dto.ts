import { Type } from "class-transformer";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsHexColor, IsInt, IsOptional, IsString, Length, Max, Min, ValidateIf } from "class-validator";
import { WorkTaskType } from "@prisma/client";
import { IsEnum } from "class-validator";

export class UploadTaskImageDto {
  @ApiProperty() @IsString() @Length(1, 150) name!: string;
  @ApiProperty() @IsString() mime!: string;
  @ApiProperty() @IsString() data!: string;
}

export class CreateTaskDto {
  @ApiProperty() @IsString() columnId!: string;
  @ApiProperty() @IsString() @Length(1, 180) title!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @ApiProperty({ enum: WorkTaskType }) @IsEnum(WorkTaskType) type!: WorkTaskType;
  @ApiPropertyOptional() @IsOptional() @IsString() clientId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() sourceMessageId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() assigneeId?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, value) => value !== null) @IsDateString() dueAt?: string | null;
  @ApiProperty() @IsHexColor() markerColor!: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @Length(1, 40, { each: true }) labels?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) attachmentPaths?: string[];
}

export class UpdateTaskDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 180) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0, 4000) description?: string;
  @ApiPropertyOptional({ enum: WorkTaskType }) @IsOptional() @IsEnum(WorkTaskType) type?: WorkTaskType;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() clientId?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, value) => value !== null) @IsString() assigneeId?: string | null;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((_, value) => value !== null) @IsDateString() dueAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsHexColor() markerColor?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @IsString({ each: true }) @Length(1, 40, { each: true }) labels?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) attachmentPaths?: string[];
}

export class MoveTaskDto {
  @ApiProperty() @IsString() columnId!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(100000) position?: number;
}

export class CreateTaskColumnDto {
  @ApiProperty() @IsString() @Length(1, 80) name!: string;
  @ApiProperty() @IsHexColor() color!: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDone?: boolean;
}

export class UpdateTaskColumnDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsHexColor() color?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000) sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDone?: boolean;
}
