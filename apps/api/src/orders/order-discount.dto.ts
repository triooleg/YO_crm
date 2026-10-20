import {Type} from 'class-transformer';
import {ApiProperty} from '@nestjs/swagger';
import {IsDefined,IsIn,IsInt,IsString,Length,Matches,Max,Min,ValidateNested} from 'class-validator';
import type {DiscountCommand} from './order-discount';
export class OrderDiscountCommandDto implements DiscountCommand {
  @ApiProperty({enum:['FIXED','PERCENT']}) @IsIn(['FIXED','PERCENT']) mode!:DiscountCommand['mode'];
  @ApiProperty() @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) value!:number;
}
export class ApplyOrderDiscountDto {
  @ApiProperty({type:OrderDiscountCommandDto}) @IsDefined() @ValidateNested() @Type(()=>OrderDiscountCommandDto) command!:OrderDiscountCommandDto;
  @ApiProperty() @IsString() @Matches(/^[a-f0-9]{64}$/) expectedToken!:string;
  @ApiProperty() @IsString() @Length(16,100) @Matches(/^[a-zA-Z0-9_-]+$/) operationKey!:string;
}
