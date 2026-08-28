CREATE TYPE "BackupType" AS ENUM ('DATA', 'FULL');
CREATE TYPE "BackupStatus" AS ENUM ('PENDING', 'RUNNING', 'VERIFYING', 'COMPLETED', 'FAILED', 'RESTORING');
CREATE TYPE "BackupStorageProvider" AS ENUM ('LOCAL', 'S3');

CREATE TABLE "Backup" (
    "id" TEXT NOT NULL,
    "type" "BackupType" NOT NULL,
    "status" "BackupStatus" NOT NULL DEFAULT 'PENDING',
    "storageProvider" "BackupStorageProvider" NOT NULL DEFAULT 'LOCAL',
    "storagePath" TEXT,
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "appVersion" TEXT,
    "gitCommit" TEXT,
    "databaseVersion" TEXT,
    "schemaVersion" TEXT,
    "createdById" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    CONSTRAINT "Backup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BackupSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "frequency" TEXT NOT NULL DEFAULT 'DAILY',
    "time" TEXT NOT NULL DEFAULT '03:00',
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Kiev',
    "backupType" "BackupType" NOT NULL DEFAULT 'DATA',
    "retentionCount" INTEGER NOT NULL DEFAULT 10,
    "storageProvider" "BackupStorageProvider" NOT NULL DEFAULT 'LOCAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BackupSetting_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Backup_status_createdAt_idx" ON "Backup"("status", "createdAt");
CREATE INDEX "Backup_type_createdAt_idx" ON "Backup"("type", "createdAt");
CREATE INDEX "Backup_archivedAt_createdAt_idx" ON "Backup"("archivedAt", "createdAt");
ALTER TABLE "Backup" ADD CONSTRAINT "Backup_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
