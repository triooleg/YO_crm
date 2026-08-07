import { ContactChannel, Discipline } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsEmail, IsEnum, IsNumber, IsOptional, IsString, Length, Min } from "class-validator";

export class CreateClientDto {
  @ApiProperty() @IsString() @Length(1, 100) firstName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() instagram?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() whatsapp?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() telegram?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() language?: string;
  @ApiPropertyOptional({ enum: ContactChannel }) @IsOptional() @IsEnum(ContactChannel) preferredChannel?: ContactChannel;
  @ApiPropertyOptional({ enum: ContactChannel }) @IsOptional() @IsEnum(ContactChannel) source?: ContactChannel;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateAthleteDto {
  @ApiProperty() @IsString() @Length(1, 100) firstName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lastName?: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() birthDate?: string;
  @ApiPropertyOptional({ enum: Discipline }) @IsOptional() @IsEnum(Discipline) discipline?: Discipline;
  @ApiPropertyOptional() @IsOptional() @IsString() club?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() coach?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}

export class CreateMeasurementDto {
  @ApiProperty() @IsDateString() measuredAt!: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) height?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) chest?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) waist?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) hips?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) torso?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?: string;
}
