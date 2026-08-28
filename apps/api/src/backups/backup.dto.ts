import { BackupType } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsBoolean, IsEnum, IsInt, IsString, Matches, Max, Min } from "class-validator";

export class CreateBackupDto {
  @IsEnum(BackupType) type: BackupType = BackupType.DATA;
}

export class BackupSettingsDto {
  @IsBoolean() enabled!: boolean;
  @IsString() @Matches(/^(HOURLY|DAILY|WEEKLY)$/) frequency!: string;
  @IsString() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) time!: string;
  @IsString() @Matches(/^[A-Za-z_]+\/[A-Za-z_+-]+$/) timezone!: string;
  @IsEnum(BackupType) backupType!: BackupType;
  @Transform(({ value }) => Number(value)) @IsInt() @Min(1) @Max(365) retentionCount!: number;
}

export class RestoreBackupDto {
  @IsString() confirmBackupId!: string;
}
