import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Min } from 'class-validator';

export class ShipmentNotificationScopeDto {
  @IsString() @Length(1,100) clientId!: string;
  @IsOptional() @IsString() @Length(1,100) conversationId?: string;
  @IsOptional() @IsString() @Length(1,30) channel?: string;
}
export class ShipmentNotificationPreviewDto extends ShipmentNotificationScopeDto {
  @IsString() @Length(1,100) orderId!: string;
  @IsString() @Length(1,100) shipmentId!: string;
  @IsOptional() @IsString() @Length(2,8) language?: string;
}
export class ShipmentNotificationSendDto extends ShipmentNotificationPreviewDto {
  @IsString() @Length(64,64) scopeToken!: string;
  @IsString() @Length(1,4000) content!: string;
  @IsString() @Length(1,200) subject!: string;
  @IsBoolean() sendChat!: boolean;
  @IsBoolean() sendEmail!: boolean;
  @IsBoolean() confirmClientEmail!: boolean;
}
export class ShipmentTrackingUrlDto {
  @IsString() @Length(1,100) orderId!: string;
  @IsString() @Length(1,100) shipmentId!: string;
  @IsOptional() @IsString() @Length(0,2048) trackingUrl?: string;
  @IsOptional() @IsIn(['uk','en']) language?: string;
  @IsInt() @Min(1) trackingRevision!: number;
}
