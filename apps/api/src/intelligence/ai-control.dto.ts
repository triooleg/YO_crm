import {Type} from "class-transformer";
import {AiSettingScope} from "@prisma/client";
import {IsDefined,IsEnum,IsInt,IsOptional,IsString,Length,Max,Min} from "class-validator";

export class UpdateAiRuntimeSettingDto{
  @IsString() @Length(1,80) key!:string;
  @IsDefined() value!:unknown;
  @IsOptional() @IsEnum(AiSettingScope) scope:AiSettingScope=AiSettingScope.GLOBAL;
  @IsOptional() @IsString() @Length(1,100) scopeId?:string;
}
export class AiRuntimeStatusQueryDto{
  @IsOptional() @IsString() @Length(1,80) channel?:string;
  @IsOptional() @IsString() @Length(1,80) clientId?:string;
  @IsOptional() @IsString() @Length(1,80) conversationId?:string;
}
export class AiRolloutDto{
  @IsInt() @Min(0) @Max(100) @Type(()=>Number) percentage!:number;
}
