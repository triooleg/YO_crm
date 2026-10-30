import { BadRequestException } from '@nestjs/common';
import { Equals, IsString, MaxLength, MinLength, validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

export class RevokeWebsiteApiKeyDto {
 @IsString() @MinLength(1) @MaxLength(512) currentPassword!:string;
 @Equals(true) confirmed!:true;
}
export class RotateWebsiteApiKeyDto extends RevokeWebsiteApiKeyDto {
 @IsString() @MinLength(1) @MaxLength(100) name!:string;
 @IsString() @MinLength(1) @MaxLength(253) sourceAccount!:string;
}
export class CreateWebsiteApiKeyDto extends RotateWebsiteApiKeyDto {}
export function parseWebsiteApiKeysCommand<T extends RevokeWebsiteApiKeyDto>(type:new()=>T,input:unknown):T {
 if(!input||typeof input!=='object'||Array.isArray(input))throw new BadRequestException('Некорректные данные ключа');
 const hasKeyMetadata=Object.is(type,CreateWebsiteApiKeyDto)||Object.is(type,RotateWebsiteApiKeyDto);
 const allowed=['currentPassword','confirmed',...(hasKeyMetadata?['name','sourceAccount']:[])];
 if(Object.keys(input).some(key=>!allowed.includes(key)))throw new BadRequestException('Некорректные данные ключа');
 const value=plainToInstance(type,input);
 if(validateSync(value,{whitelist:true,forbidNonWhitelisted:true,forbidUnknownValues:true}).length)throw new BadRequestException('Некорректные данные ключа');
 if('name' in value){const name=String(value.name).trim();if(!name||/[\u0000-\u001f\u007f]/.test(name))throw new BadRequestException('Некорректное название ключа');value.name=name;}
 return value;
}
