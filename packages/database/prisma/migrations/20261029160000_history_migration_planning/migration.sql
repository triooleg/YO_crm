BEGIN;

ALTER TABLE "HistoryMigrationJob" ADD COLUMN "mappingRevision" INTEGER NOT NULL DEFAULT 0 CHECK ("mappingRevision">=0);
CREATE TABLE "HistoryMigrationTarget" (
  "id" TEXT PRIMARY KEY,
  "jobId" TEXT NOT NULL REFERENCES "HistoryMigrationJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "dialogueId" TEXT NOT NULL CHECK (length("dialogueId") BETWEEN 1 AND 512),
  "mode" TEXT NOT NULL CHECK ("mode" IN ('EXISTING','CREATE_PROPOSAL')),
  "clientId" TEXT REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "evidenceEncrypted" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK ("revision">=1),
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "HistoryMigrationTarget_kind_client_check" CHECK (("mode"='EXISTING' AND "clientId" IS NOT NULL) OR ("mode"='CREATE_PROPOSAL' AND "clientId" IS NULL))
);
CREATE UNIQUE INDEX "HistoryMigrationTarget_jobId_dialogueId_key" ON "HistoryMigrationTarget"("jobId","dialogueId");
CREATE INDEX "HistoryMigrationTarget_clientId_idx" ON "HistoryMigrationTarget"("clientId");
CREATE TABLE "HistoryMigrationPilotRun" (
  "id" TEXT PRIMARY KEY,
  "jobId" TEXT NOT NULL REFERENCES "HistoryMigrationJob"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "environment" TEXT NOT NULL DEFAULT 'ISOLATED_WASM' CHECK ("environment"='ISOLATED_WASM'),
  "sourceDigest" TEXT NOT NULL CHECK ("sourceDigest" ~ '^[0-9a-f]{64}$'),
  "previewDigest" TEXT NOT NULL CHECK ("previewDigest" ~ '^[0-9a-f]{64}$'),
  "status" TEXT NOT NULL DEFAULT 'APPLIED' CHECK ("status" IN ('APPLIED','ROLLED_BACK')),
  "result" JSONB NOT NULL,
  "snapshotEncrypted" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "rolledBackAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "HistoryMigrationPilotRun_jobId_sourceDigest_key" ON "HistoryMigrationPilotRun"("jobId","sourceDigest");
CREATE TABLE "HistoryMigrationOrigin" (
  "id" TEXT PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{64}$'),
  "runId" TEXT NOT NULL REFERENCES "HistoryMigrationPilotRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "messageId" TEXT NOT NULL REFERENCES "Message"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payloadEncrypted" TEXT NOT NULL,
  "createdMessage" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "HistoryMigrationOrigin_messageId_idx" ON "HistoryMigrationOrigin"("messageId");
CREATE TABLE "HistoryMigrationIdentity" (
  "id" TEXT PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{64}$'),
  "runId" TEXT NOT NULL REFERENCES "HistoryMigrationPilotRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "clientId" TEXT NOT NULL REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "payloadEncrypted" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "HistoryMigrationIdentity_clientId_idx" ON "HistoryMigrationIdentity"("clientId");

COMMIT;
