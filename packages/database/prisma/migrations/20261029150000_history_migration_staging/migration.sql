BEGIN;

-- Additive historical staging only. Never changes operational messages or clients.
CREATE TABLE "HistoryMigrationJob" (
  "id" TEXT PRIMARY KEY,
  "createdById" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "source" TEXT NOT NULL CHECK ("source" = 'KEYCRM'),
  "account" TEXT NOT NULL CHECK (length("account") BETWEEN 1 AND 160),
  "channel" TEXT NOT NULL CHECK ("channel" IN ('EMAIL','FACEBOOK','INSTAGRAM','WHATSAPP')),
  "status" TEXT NOT NULL DEFAULT 'STAGING' CHECK ("status" IN ('STAGING','CLOSED')),
  "tokenHash" TEXT UNIQUE CHECK ("tokenHash" IS NULL OR "tokenHash" ~ '^[a-f0-9]{64}$'),
  "agentExpiresAt" TIMESTAMP(3),
  "agentRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("agentRevision" >= 0),
  "batchCount" INTEGER NOT NULL DEFAULT 0 CHECK ("batchCount" BETWEEN 0 AND 100),
  "messageCount" INTEGER NOT NULL DEFAULT 0 CHECK ("messageCount" BETWEEN 0 AND 1000),
  "payloadBytes" INTEGER NOT NULL DEFAULT 0 CHECK ("payloadBytes" BETWEEN 0 AND 33554432),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "HistoryMigrationJob_createdById_status_idx" ON "HistoryMigrationJob"("createdById","status");
CREATE TABLE "HistoryMigrationBatch" (
  "id" TEXT PRIMARY KEY,
  "jobId" TEXT NOT NULL REFERENCES "HistoryMigrationJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "batchId" TEXT NOT NULL,
  "checksum" TEXT NOT NULL CHECK ("checksum" ~ '^[a-f0-9]{64}$'),
  "encryptedPayload" TEXT NOT NULL,
  "messageCount" INTEGER NOT NULL CHECK ("messageCount" BETWEEN 1 AND 100),
  "payloadBytes" INTEGER NOT NULL CHECK ("payloadBytes" BETWEEN 1 AND 524288),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "HistoryMigrationBatch_jobId_batchId_key" ON "HistoryMigrationBatch"("jobId","batchId");
CREATE UNIQUE INDEX "HistoryMigrationBatch_jobId_checksum_key" ON "HistoryMigrationBatch"("jobId","checksum");
CREATE INDEX "HistoryMigrationBatch_jobId_createdAt_idx" ON "HistoryMigrationBatch"("jobId","createdAt");

COMMIT;
