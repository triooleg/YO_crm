import { Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class OverviewOrdersQueryDto {
  @IsOptional() @IsString() @MaxLength(7) month?:string;
  @IsOptional() @Type(()=>Number) @IsIn([3,6,12]) range?:number;
  @IsOptional() @IsIn(['EUR','USD','UAH']) currency?:string;
}
