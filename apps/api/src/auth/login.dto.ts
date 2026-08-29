import { ApiProperty } from "@nestjs/swagger";
import { IsEmail, IsOptional, IsString, MinLength } from "class-validator";

export class LoginDto {
  @ApiProperty()
  @IsEmail()
  email!: string;
  @ApiProperty()
  @IsString()
  @MinLength(8)
  password!: string;
}

export class UpdateAccountDto {
  @IsString() @MinLength(8) currentPassword!: string;
  @IsOptional() @IsEmail({}, { message: "Введите корректный e-mail" }) email?: string;
  @IsOptional() @IsString() @MinLength(12, { message: "Новый пароль должен содержать не менее 12 символов" }) newPassword?: string;
}
