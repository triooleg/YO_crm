import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Discipline } from '@prisma/client';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsDefined, IsEnum, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min, ValidateNested } from 'class-validator';
import type { CompositionCommand } from './order-composition';
export class OrderCompositionCommandDto implements CompositionCommand {
  @ApiProperty() @IsIn(['ADD','EDIT','DUPLICATE','QUANTITY','ARCHIVE']) action!:CompositionCommand['action'];
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,100) itemId?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,300) name?:string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(1000) quantity?:number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(2_147_483_647) priceMinor?:number;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,150) modelImagePath?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,200) sku?:string|null;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(0,5000) notes?:string|null;
  @ApiPropertyOptional({enum:Discipline}) @IsOptional() @IsEnum(Discipline) discipline?:Discipline|null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(2_147_483_647) designNumber?:number|null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(2_147_483_647) standardHeight?:number|null;
  @ApiPropertyOptional() @IsOptional() @IsArray() @ArrayMaxSize(1000) @ArrayUnique() @IsString({each:true}) archiveInstanceIds?:string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() copyAssignments?:boolean;
}
export class ApplyOrderCompositionDto {
  @ApiProperty({type:OrderCompositionCommandDto}) @IsDefined() @ValidateNested() @Type(()=>OrderCompositionCommandDto) command!:OrderCompositionCommandDto;
  @ApiProperty() @IsString() @Matches(/^[a-f0-9]{64}$/) expectedToken!:string;
  @ApiProperty() @IsString() @Length(16,100) @Matches(/^[a-zA-Z0-9_-]+$/) operationKey!:string;
}
