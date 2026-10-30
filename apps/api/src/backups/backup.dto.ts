import { BackupType } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
export class CreateBackupDto {
  @IsEnum(BackupType) type: BackupType = BackupType.DATA;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9._:-]{8,128}$/) idempotencyKey?: string;
}
export class BackupSettingsDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @Matches(/^(HOURLY|DAILY|WEEKLY)$/) frequency!: string;
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time!: string;
  @IsString() @Matches(/^[A-Za-z_]+\/[A-Za-z_+-]+$/) timezone!: string;
  @IsEnum(BackupType) backupType!: BackupType;
  @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(365) retentionCount!: number;
  @IsOptional() @IsObject() recovery?: Record<string, unknown>;
}
export class RestoreBackupDto { @IsString() confirmBackupId!: string; }
export class BackupPasswordDto { @IsString() @MinLength(1) @MaxLength(1024) currentPassword!: string; }
export class BackupDrillDto extends BackupPasswordDto {
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9._:-]{8,128}$/) idempotencyKey?: string;
}
export class BackupRecoveryPlanDto extends BackupPasswordDto { @IsString() confirmBackupId!: string; }
export class BackupUploadDto extends BackupPasswordDto { @IsEnum(BackupType) type!: BackupType; }
