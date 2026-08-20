import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from "class-validator";
import { ContactChannel } from "@prisma/client";
export const ALLOWED_AI_MODELS = [
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-5-mini",
] as const;
export class ConversationQueryDto {
  @IsOptional() @IsEnum(ContactChannel) channel?: ContactChannel;
}
export class SendMessageDto {
  @IsString() @Length(1, 5000) content!: string;
  @IsOptional() @IsEnum(ContactChannel) channel?: ContactChannel;
}
export class MessageTemplateDto {
  @IsString() @Length(1, 120) name!: string;
  @IsString() @Length(1, 5000) content!: string;
  @IsOptional() @IsEnum(ContactChannel) channel?: ContactChannel;
  @IsOptional() @IsString() @Length(2, 20) language?: string;
}
export class IntegrationSettingsDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsUrl({ require_tld: false }) baseUrl?: string;
  @IsOptional() @IsString() @MaxLength(80) accountId?: string;
  @IsOptional() @IsString() @MaxLength(80) inboxId?: string;
  @IsOptional() @IsString() @MaxLength(500) accessToken?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== "") @IsString() @Length(8, 500) webhookSecret?: string;
  @IsOptional() @IsBoolean() removeAccessToken?: boolean;
  @IsOptional() @IsBoolean() removeWebhookSecret?: boolean;
  @IsOptional() @IsString() @MaxLength(255) smtpHost?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) smtpPort?: number;
  @IsOptional() @IsString() @MaxLength(255) username?: string;
  @IsOptional() @IsString() @MaxLength(500) password?: string;
  @IsOptional() @IsBoolean() removePassword?: boolean;
  @IsOptional() @IsEmail() fromAddress?: string;
}
export class ChatwootIntegrationDto extends IntegrationSettingsDto {}
export class EmailIntegrationDto extends IntegrationSettingsDto {}
export class MetaIntegrationDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() @MaxLength(80) appId?: string;
  @IsOptional() @IsString() @MaxLength(80) pageId?: string;
  @IsOptional() @IsString() @MaxLength(80) instagramAccountId?: string;
  @IsOptional() @IsString() @MaxLength(80) whatsappPhoneNumberId?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== "") @IsString() @Length(8, 500) appSecret?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== "") @IsString() @Length(8, 500) verifyToken?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== "") @IsString() @Length(20, 1000) pageAccessToken?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== "") @IsString() @Length(20, 1000) whatsappAccessToken?: string;
  @IsOptional() @IsBoolean() removeAppSecret?: boolean;
  @IsOptional() @IsBoolean() removeVerifyToken?: boolean;
  @IsOptional() @IsBoolean() removePageAccessToken?: boolean;
  @IsOptional() @IsBoolean() removeWhatsappAccessToken?: boolean;
}
export class AiRequestDto {
  @IsIn(["REPLY", "TRANSLATE", "IMPROVE", "TEMPLATE"] as const) action!:
    | "REPLY"
    | "TRANSLATE"
    | "IMPROVE"
    | "TEMPLATE";
  @IsString() @MaxLength(12000) text!: string;
  @IsOptional() @IsString() @MaxLength(50) targetLanguage?: string;
  @IsOptional() @IsString() @MaxLength(2000) instructions?: string;
  @IsOptional() @IsString() clientId?: string;
}
export class AiSettingsDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsBoolean() allowClientContext?: boolean;
  @IsOptional()
  @IsIn(ALLOWED_AI_MODELS)
  model?: (typeof ALLOWED_AI_MODELS)[number];
  @IsOptional() @IsString() @MaxLength(80) defaultLanguage?: string;
  @IsOptional() @IsString() @MaxLength(80) tone?: string;
  @IsOptional() @IsString() @MaxLength(4000) systemPrompt?: string;
  @IsOptional() @IsString() @Length(20, 500) apiKey?: string;
  @IsOptional() @IsBoolean() removeApiKey?: boolean;
}
