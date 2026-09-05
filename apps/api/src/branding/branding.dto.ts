import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from "class-validator";

export class UpdateBrandingDto {
  @ApiProperty() @IsBoolean() useInHeader!: boolean;
  @ApiProperty() @IsBoolean() useInMessages!: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() removeLogo?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(1, 150) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) mime?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4_200_000) data?: string;
}
