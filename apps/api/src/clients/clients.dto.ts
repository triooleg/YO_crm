import { ContactChannel, Discipline } from "@prisma/client";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsDateString, IsEmail, IsEnum, IsNumber, IsOptional, IsString, Length, Min, IsIn } from "class-validator";

export class CreateClientDto {
  @ApiProperty() @IsString() @Length(1,100) firstName!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1,100) lastName?:string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() instagram?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() whatsapp?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() telegram?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() language?:string;
  @ApiPropertyOptional({enum:ContactChannel}) @IsOptional() @IsEnum(ContactChannel) preferredChannel?:ContactChannel;
  @ApiPropertyOptional({enum:ContactChannel}) @IsOptional() @IsEnum(ContactChannel) source?:ContactChannel;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?:string;
}
export class PromoteInboxClientDto extends CreateClientDto {}
export class CreateAthleteDto {
  @ApiProperty() @IsString() @Length(1,100) firstName!:string;
  @ApiPropertyOptional() @IsOptional() @IsString() lastName?:string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() birthDate?:string;
  @ApiPropertyOptional({enum:Discipline}) @IsOptional() @IsEnum(Discipline) discipline?:Discipline;
  @ApiPropertyOptional() @IsOptional() @IsString() club?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() coach?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() country?:string;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?:string;
}
export class CreateMeasurementDto {
  @ApiProperty() @IsDateString() measuredAt!:string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @IsIn([105,110,115,120,125,130,135,140,144,148,152,156,159,162,165,168,172]) standardHeight?:number;
  @ApiProperty() @IsNumber() @Min(1) m1!:number;
  @ApiProperty() @IsNumber() @Min(1) m2!:number;
  @ApiProperty() @IsNumber() @Min(1) m3!:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m4?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m5?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m6?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m7?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m8?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m9?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m10?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m11?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m12?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m13?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m14?:number;
  @ApiProperty() @IsNumber() @Min(1) m15!:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m16?:number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(1) m17?:number;
  @ApiPropertyOptional() @IsOptional() @IsString() notes?:string;
}
