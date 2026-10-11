ALTER TABLE "KeycrmSyncRun"
  ADD COLUMN "rolledBackAt" TIMESTAMP(3),
  ADD COLUMN "rollbackActorId" TEXT,
  ADD COLUMN "rollbackEligible" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "rollbackBlockedReason" TEXT;

CREATE TABLE "KeycrmSyncMutation" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "externalOrderId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "beforeSnapshot" JSONB,
  "afterSnapshot" JSONB NOT NULL,
  "createdClientId" TEXT,
  "rolledBackAt" TIMESTAMP(3),
  "rollbackEligible" BOOLEAN NOT NULL DEFAULT false,
  "rollbackBlockedReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeycrmSyncMutation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "KeycrmSyncMutation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KeycrmSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KeycrmSyncMutation_runId_externalOrderId_key" ON "KeycrmSyncMutation"("runId", "externalOrderId");
CREATE UNIQUE INDEX "KeycrmSyncMutation_runId_sequence_key" ON "KeycrmSyncMutation"("runId", "sequence");
CREATE INDEX "KeycrmSyncMutation_orderId_idx" ON "KeycrmSyncMutation"("orderId");

ALTER TABLE "KeycrmClientLink"
  ADD COLUMN "rolledBackAt" TIMESTAMP(3);
