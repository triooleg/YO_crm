import { Type } from 'class-transformer';
import { ArrayMaxSize, Equals, IsArray, IsEnum, IsInt, IsNumber, IsString, IsUUID, Matches, Max, Min, ValidateBy, ValidateIf, ValidateNested } from 'class-validator';
import { Discipline } from '@prisma/client';
import type { ConfigureRangesInput } from './parent-measurements-ranges.service';

// IsDivisibleBy parses the divisor as an integer and cannot validate a 0.5-cm grid.
const IsHalfCentimetre = () => ValidateBy({ name: 'isHalfCentimetre', validator: {
  validate: (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value * 2),
  defaultMessage: () => 'Измерение должно иметь шаг 0,5 см',
} });

export class ParentRangeRuleDto {
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/^[A-Za-z0-9_-]{1,8}$/)
  id?: string;

  @IsInt() @Min(1) @Max(17)
  field!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(1) @Max(9996.5) @IsHalfCentimetre()
  lowerCm!: number;

  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(1) @Max(9996.5) @IsHalfCentimetre()
  upperCm!: number;

  @ValidateIf((_object, value) => value !== undefined) @IsEnum(Discipline)
  discipline?: Discipline;

  // Same technical height bounds as the parent-draft normalizer; these are not body norms.
  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(1) @Max(9999.5) @IsHalfCentimetre()
  minHeightCm?: number;

  @ValidateIf((_object, value) => value !== undefined)
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(1) @Max(9999.5) @IsHalfCentimetre()
  maxHeightCm?: number;
}

export class ParentRangesConfigureDto implements ConfigureRangesInput {
  @IsArray() @ArrayMaxSize(512) @ValidateNested({ each: true }) @Type(() => ParentRangeRuleDto)
  rules!: ParentRangeRuleDto[];

  // Null explicitly means "no prior configuration". Missing values must still fail validation.
  @ValidateIf((_object, value) => value !== null) @IsUUID()
  expectedVersion!: string | null;

  @Equals(true)
  approvedForBodyMeasurements!: true;
}
