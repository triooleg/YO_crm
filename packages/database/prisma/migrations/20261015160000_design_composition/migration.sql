-- Expand only. Existing rows and stable references are preserved; no instance backfill.
ALTER TABLE "OrderItem" ADD COLUMN "archivedAt" TIMESTAMP(3);
ALTER TABLE "OrderItem" ADD COLUMN "discipline" "Discipline";
CREATE INDEX "OrderItem_orderId_archivedAt_idx" ON "OrderItem"("orderId", "archivedAt");
ALTER TABLE "OrderItemInstance" ADD COLUMN "standardHeight" INTEGER;
ALTER TABLE "Measurement" ADD COLUMN "archivedAt" TIMESTAMP(3);
CREATE INDEX "Measurement_athleteId_archivedAt_measuredAt_idx" ON "Measurement"("athleteId", "archivedAt", "measuredAt");
CREATE TABLE "OrderCompositionOperation" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "operationKey" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "result" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OrderCompositionOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderCompositionOperation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "OrderCompositionOperation_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "OrderCompositionOperation_orderId_operationKey_key" ON "OrderCompositionOperation"("orderId", "operationKey");
