import { IsIn, IsString, IsOptional, MaxLength, MinLength, Matches } from 'class-validator';

export class HistoryPasswordDto { @IsString() @MinLength(1) @MaxLength(1024) currentPassword!: string; }
export class ApplyOperationalHistoryDto extends HistoryPasswordDto {
  @IsString() @Matches(/^[a-f0-9]{64}$/) previewDigest!: string;
}
export class CreateHistoryJobDto extends HistoryPasswordDto {
  @IsIn(['KEYCRM']) source!: string;
  @IsString() @MinLength(1) @MaxLength(160) account!: string;
  @IsIn(['EMAIL', 'FACEBOOK', 'INSTAGRAM', 'WHATSAPP']) channel!: string;
}
export class StageHistoryPacketDto {
  @IsString() @MaxLength(36) batchId!: string;
  @IsString() @MaxLength(64) checksum!: string;
  @IsString() @MaxLength(524288) payloadJson!: string;
}
export class ResolveHistoryTargetDto {
  @IsString() @MinLength(1) @MaxLength(512) dialogueId!: string;
  @IsOptional() @IsString() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
}
export class BindHistoryTargetDto extends HistoryPasswordDto {
  @IsString() @MinLength(1) @MaxLength(512) dialogueId!: string;
  @IsIn(['EXISTING', 'CREATE_PROPOSAL']) mode!: string;
  @IsOptional() @IsString() @MaxLength(128) clientId?: string;
  @IsOptional() @IsString() @MaxLength(512) subjectId?: string;
  @IsOptional() @IsString() @MaxLength(160) displayName?: string;
}
