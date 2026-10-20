ALTER TABLE "ProductionSlot"
  ADD COLUMN "sourceSystem" TEXT,
  ADD COLUMN "sourceAccount" TEXT,
  ADD COLUMN "externalId" TEXT;

CREATE UNIQUE INDEX "ProductionSlot_sourceSystem_sourceAccount_externalId_key"
  ON "ProductionSlot"("sourceSystem", "sourceAccount", "externalId");

ALTER TABLE "Order" ADD COLUMN "externalImageUrl" TEXT;
