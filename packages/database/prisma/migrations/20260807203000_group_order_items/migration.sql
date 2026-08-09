ALTER TABLE "OrderItem" ADD COLUMN "athleteId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "measurementId" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "modelImagePath" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "productionStatus" "ProductionStatus" NOT NULL DEFAULT 'NOT_SCHEDULED';

CREATE INDEX "OrderItem_orderId_productionStatus_idx" ON "OrderItem"("orderId", "productionStatus");
CREATE INDEX "OrderItem_athleteId_idx" ON "OrderItem"("athleteId");

ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE SET NULL ON UPDATE CASCADE;
