import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateIf, ValidateNested } from 'class-validator';
import { CreateAthleteDto, CreateMeasurementDto } from '../clients/clients.dto';

export class CreateOrderAthleteDto extends CreateAthleteDto {
  @ApiProperty() @IsString() @Length(16,100) @Matches(/^[a-zA-Z0-9_-]+$/) operationKey!:string;
}
export class CreateOrderSnapshotDto extends CreateMeasurementDto {
  @ApiProperty() @IsString() @Length(16,100) @Matches(/^[a-zA-Z0-9_-]+$/) operationKey!:string;
}

export class MeasurementAssignmentTargetDto {
  @ApiProperty() @IsString() @Length(1, 100) id!: string;
  @ApiProperty() @IsDateString() expectedUpdatedAt!: string;
}

export class AssignOrderMeasurementsDto {
  @ApiPropertyOptional() @IsOptional() @IsBoolean() confirmProduction?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,2000) reason?: string;
  @ApiProperty({ type: [MeasurementAssignmentTargetDto] })
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ArrayUnique((target: MeasurementAssignmentTargetDto | null) => target?.id)
  @ValidateNested({ each: true }) @Type(() => MeasurementAssignmentTargetDto)
  targets!: MeasurementAssignmentTargetDto[];

  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() @Length(1, 100)
  athleteId!: string | null;
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsString() @Length(1, 100)
  measurementId!: string | null;
  // This is a manual costume size, not the measurement form's height-preset enum.
  @ApiPropertyOptional({ nullable: true }) @ValidateIf((_, value) => value !== undefined && value !== null)
  @IsInt() @Min(1) @Max(2_147_483_647) standardHeight?: number | null;
}

export class MeasurementUsageQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 100) athleteId?: string;
  @ApiPropertyOptional({ default: 1 }) @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @ApiPropertyOptional({ default: 25 }) @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class ArchiveOrderMeasurementDto {
  @ApiProperty({ nullable: true }) @ValidateIf((_, value) => value !== null) @IsDateString()
  expectedArchivedAt!: string | null;
}

export class ArchiveOrderAthleteDto {
  @ApiProperty() @IsDateString() expectedUpdatedAt!: string;
}
