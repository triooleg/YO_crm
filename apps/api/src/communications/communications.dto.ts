import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from "class-validator";
import { Transform, Type } from "class-transformer";
import { ContactChannel } from "@prisma/client";
import { COMMUNICATION_UPLOAD_MAX_DATA_CHARS } from "./communication-file";
export const ALLOWED_AI_MODELS = [
  "gpt-4.1-mini",
  "gpt-4.1",
  "gpt-5-mini",
] as const;
export class ConversationQueryDto {
  @IsOptional() @IsEnum(ContactChannel) channel?: ContactChannel;
}
export class CommunicationsListQueryDto {
  @IsOptional() @IsInt() @Min(0) @Type(() => Number) offset = 0;
  @IsOptional() @IsInt() @Min(1) @Max(60) @Type(() => Number) limit = 15;
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional()
  @Transform(({ value }) => Array.isArray(value) ? value : String(value).split(",").filter(Boolean))
  @IsArray() @ArrayMaxSize(5) @IsEnum(ContactChannel, { each: true }) channels?: ContactChannel[];
  @IsOptional() @IsIn(["WITH_ORDERS", "ACTIVE_ORDERS"] as const) orderScope?: "WITH_ORDERS" | "ACTIVE_ORDERS";
  @IsOptional() @IsIn(["UNREAD", "CLIENTS"] as const) conversationScope?: "UNREAD" | "CLIENTS";
}
export class ReadConversationDto {
  @IsString() @Length(1, 80) id!: string;
  @IsInt() @Min(0) unreadVersion!: number;
}
export class MarkConversationsReadDto {
  @ArrayMinSize(1) @ArrayMaxSize(20) @ValidateNested({ each: true })
  @Type(() => ReadConversationDto)
  conversations!: ReadConversationDto[];
}
export class OutboundAttachmentDto {
  @IsString() @Length(1, 120) path!: string;
  @IsString() @Length(1, 180) name!: string;
  @IsString() @IsIn(["image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "application/pdf", "text/plain"]) mimeType!: string;
}
export class SendMessageDto {
  @ValidateIf((dto, value) => !dto.attachment || value !== undefined) @IsString() @Length(1, 5000) content?: string;
  @IsOptional() @IsEnum(ContactChannel) channel?: ContactChannel;
  @IsOptional() @IsIn(["DRAFT", "SEND"] as const) action?: "DRAFT" | "SEND";
  @IsOptional() @IsUUID("4") clientRequestId?: string;
  @IsOptional() @IsString() @Length(20, 80) draftMessageId?: string;
  @IsOptional() @IsString() @Length(20, 80) aiRunId?: string;
  @IsOptional() @IsString() @Length(20, 80) replyToMessageId?: string;
  @IsOptional() @ValidateNested() @Type(() => OutboundAttachmentDto) attachment?: OutboundAttachmentDto;
}
export class UpdateMessageDraftDto {
  @IsString() @Length(1, 5000) content!: string;
  @IsEnum(ContactChannel) channel!: ContactChannel;
}
export class MessageReactionDto {
  @IsIn(["react", "unreact"] as const) action!: "react" | "unreact";
  @IsOptional() @IsString() @IsIn(["❤️", "😂", "😮", "😢", "😡", "👍"] as const) emoji?: string;
}
export class DeleteMessageDto {
  @IsIn(["CRM", "CLIENT"] as const) mode!: "CRM" | "CLIENT";
  @IsOptional() @IsBoolean() resolveDelivery?: boolean;
}
export class UploadCommunicationAttachmentDto {
  @IsString() @Length(1, 180) name!: string;
  @IsString() @MaxLength(120) mimeType!: string;
  @IsString() @MaxLength(COMMUNICATION_UPLOAD_MAX_DATA_CHARS) data!: string;
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
  @IsOptional() @IsIn(["smtp.gmail.com"] as const) smtpHost?: string;
  @IsOptional() @IsIn([465, 587] as const) smtpPort?: number;
  @IsOptional() @IsIn(["imap.gmail.com"] as const) imapHost?: string;
  @IsOptional() @IsIn([993] as const) imapPort?: number;
  @IsOptional() @IsEmail() username?: string;
  @IsOptional() @IsString() @MaxLength(500) password?: string;
  @IsOptional() @IsBoolean() removePassword?: boolean;
  @IsOptional() @IsEmail() fromAddress?: string;
  @IsOptional() @IsString() @MaxLength(5000) signature?: string;
}
export class ChatwootIntegrationDto extends IntegrationSettingsDto {}
export class EmailIntegrationDto extends IntegrationSettingsDto {}
export class MetaIntegrationDto {
  @IsBoolean() enabled!: boolean;
  @IsOptional() @IsString() @MaxLength(80) appId?: string;
  @IsOptional() @IsString() @MaxLength(80) pageId?: string;
  @IsOptional() @IsString() @MaxLength(80) instagramAccountId?: string;
  @IsOptional() @IsString() @MaxLength(80) instagramAppId?: string;
  @IsOptional() @IsString() @MaxLength(80) whatsappPhoneNumberId?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== "") @IsString() @Length(8, 500) appSecret?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== "") @IsString() @Length(8, 500) verifyToken?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== "") @IsString() @Length(20, 1000) pageAccessToken?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== "") @IsString() @Length(8, 500) instagramAppSecret?: string;
  @IsOptional() @ValidateIf((_object, value) => value !== "") @IsString() @Length(20, 1000) whatsappAccessToken?: string;
  @IsOptional() @IsBoolean() removeAppSecret?: boolean;
  @IsOptional() @IsBoolean() removeVerifyToken?: boolean;
  @IsOptional() @IsBoolean() removePageAccessToken?: boolean;
  @IsOptional() @IsBoolean() removeInstagramAppSecret?: boolean;
  @IsOptional() @IsBoolean() removeWhatsappAccessToken?: boolean;
}
export class MetaOauthConnectDto {
  @IsString() @Length(1, 80) pageId!: string;
  @IsString() @Length(16, 80) flowId!: string;
}
export class MetaProfileBackfillDto {
  @IsBoolean() dryRun!: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number;
  @IsOptional() @IsString() @MaxLength(80) cursor?: string;
}
export class MetaDataDeletionCompleteDto {
  @IsString() @Length(1, 80) clientId!: string;
  @IsOptional() @IsString() @MaxLength(500) retentionNote?: string;
}
export class AiRequestDto {
  @IsIn(["REPLY", "FINALIZE_REPLY", "TRANSLATE", "IMPROVE", "TEMPLATE"] as const) action!:
    | "REPLY"
    | "FINALIZE_REPLY"
    | "TRANSLATE"
    | "IMPROVE"
    | "TEMPLATE";
  @IsString() @MaxLength(12000) text!: string;
  @IsOptional() @IsString() @MaxLength(50) targetLanguage?: string;
  @IsOptional() @IsString() @MaxLength(2000) instructions?: string;
  @IsOptional() @IsString() clientId?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) @MaxLength(80, { each: true }) messageIds?: string[];
  @IsOptional() @IsString() @Length(20, 80) aiRunId?: string;
}
export class ConversationSummaryQueryDto {
  @IsEnum(ContactChannel) channel!: ContactChannel;
}
export class GenerateConversationSummaryDto extends ConversationSummaryQueryDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) fromDate!: string;
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
