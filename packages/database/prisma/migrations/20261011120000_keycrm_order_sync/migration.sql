CREATE TYPE "KeycrmSyncMode" AS ENUM ('DRY_RUN', 'APPLY');
CREATE TYPE "KeycrmSyncStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED');

ALTER TABLE "Order"
  ADD COLUMN "deliveryRecipientPhone" TEXT,
  ADD COLUMN "deliveryServiceName" TEXT,
  ADD COLUMN "deliveryTrackingCode" TEXT,
  ADD COLUMN "taxMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "giftWrapMinor" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "buyerComment" TEXT,
  ADD COLUMN "managerComment" TEXT,
  ADD COLUMN "giftMessage" TEXT,
  ADD COLUMN "promocode" TEXT,
  ADD COLUMN "isGift" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sourceSystem" TEXT,
  ADD COLUMN "sourceAccount" TEXT,
  ADD COLUMN "sourceLinkMode" TEXT,
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "externalNumber" TEXT,
  ADD COLUMN "externalUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "externalData" JSONB;

ALTER TABLE "OrderItem"
  ADD COLUMN "externalImageUrl" TEXT,
  ADD COLUMN "sku" TEXT,
  ADD COLUMN "properties" JSONB,
  ADD COLUMN "sourceSystem" TEXT,
  ADD COLUMN "sourceAccount" TEXT,
  ADD COLUMN "externalId" TEXT;

ALTER TABLE "Payment"
  ADD COLUMN "sourceSystem" TEXT,
  ADD COLUMN "sourceAccount" TEXT,
  ADD COLUMN "externalId" TEXT,
  ADD COLUMN "externalStatus" TEXT,
  ADD COLUMN "voidedAt" TIMESTAMP(3),
  ADD COLUMN "voidReason" TEXT;

ALTER TABLE "Shipment"
  ADD COLUMN "serviceName" TEXT,
  ADD COLUMN "externalServiceId" TEXT,
  ADD COLUMN "externalStatus" TEXT;

CREATE UNIQUE INDEX "Order_sourceSystem_sourceAccount_externalId_key" ON "Order"("sourceSystem", "sourceAccount", "externalId");
CREATE UNIQUE INDEX "OrderItem_sourceSystem_sourceAccount_externalId_key" ON "OrderItem"("sourceSystem", "sourceAccount", "externalId");
CREATE UNIQUE INDEX "Payment_sourceSystem_sourceAccount_externalId_key" ON "Payment"("sourceSystem", "sourceAccount", "externalId");

CREATE TABLE "KeycrmClientLink" (
  "id" TEXT NOT NULL,
  "connectionKey" TEXT NOT NULL,
  "keycrmBuyerId" INTEGER NOT NULL,
  "clientId" TEXT NOT NULL,
  "sourcePayload" JSONB,
  "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeycrmClientLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "KeycrmClientLink_connectionKey_keycrmBuyerId_key" ON "KeycrmClientLink"("connectionKey", "keycrmBuyerId");
CREATE INDEX "KeycrmClientLink_clientId_idx" ON "KeycrmClientLink"("clientId");
CREATE INDEX "KeycrmClientLink_lastSyncedAt_idx" ON "KeycrmClientLink"("lastSyncedAt");

CREATE TABLE "KeycrmSyncRun" (
  "id" TEXT NOT NULL,
  "mode" "KeycrmSyncMode" NOT NULL,
  "status" "KeycrmSyncStatus" NOT NULL DEFAULT 'PENDING',
  "startedById" TEXT NOT NULL,
  "previewRunId" TEXT,
  "clientRequestId" TEXT NOT NULL,
  "configRevision" INTEGER NOT NULL,
  "requestedFrom" TIMESTAMP(3),
  "requestedTo" TIMESTAMP(3),
  "currentPage" INTEGER NOT NULL DEFAULT 1,
  "totalPages" INTEGER,
  "pageSize" INTEGER NOT NULL DEFAULT 50,
  "totalRemote" INTEGER,
  "scannedCount" INTEGER NOT NULL DEFAULT 0,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "updatedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "context" JSONB,
  "errorMessage" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3),
  "leaseOwner" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "KeycrmSyncRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KeycrmSyncRun_status_createdAt_idx" ON "KeycrmSyncRun"("status", "createdAt");
CREATE INDEX "KeycrmSyncRun_status_nextAttemptAt_leaseUntil_createdAt_idx" ON "KeycrmSyncRun"("status", "nextAttemptAt", "leaseUntil", "createdAt");
CREATE INDEX "KeycrmSyncRun_previewRunId_idx" ON "KeycrmSyncRun"("previewRunId");
CREATE UNIQUE INDEX "KeycrmSyncRun_clientRequestId_key" ON "KeycrmSyncRun"("clientRequestId");

CREATE TABLE "KeycrmSyncIssue" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "externalOrderId" TEXT,
  "code" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "KeycrmSyncIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "KeycrmSyncIssue_runId_createdAt_idx" ON "KeycrmSyncIssue"("runId", "createdAt");
CREATE INDEX "KeycrmSyncIssue_externalOrderId_idx" ON "KeycrmSyncIssue"("externalOrderId");

ALTER TABLE "KeycrmClientLink" ADD CONSTRAINT "KeycrmClientLink_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KeycrmSyncRun" ADD CONSTRAINT "KeycrmSyncRun_startedById_fkey" FOREIGN KEY ("startedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KeycrmSyncIssue" ADD CONSTRAINT "KeycrmSyncIssue_runId_fkey" FOREIGN KEY ("runId") REFERENCES "KeycrmSyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
