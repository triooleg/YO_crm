DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "OrderItem" WHERE "quantity" < 1 OR "quantity" > 100) THEN
    RAISE EXCEPTION 'OrderItem quantity must be between 1 and 100 before instance backfill';
  END IF;
END $$;

CREATE TABLE "OrderItemInstance" (
  "id" TEXT NOT NULL,
  "orderItemId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "athleteId" TEXT,
  "measurementId" TEXT,
  "productionStatus" "ProductionStatus" NOT NULL DEFAULT 'NOT_SCHEDULED',
  "plannedStartAt" TIMESTAMP(3),
  "plannedEndAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3),
  CONSTRAINT "OrderItemInstance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OrderItemInstance_ordinal_check" CHECK ("ordinal" > 0)
);

CREATE UNIQUE INDEX "OrderItemInstance_orderItemId_ordinal_key" ON "OrderItemInstance"("orderItemId", "ordinal");
CREATE INDEX "OrderItemInstance_athleteId_idx" ON "OrderItemInstance"("athleteId");
CREATE INDEX "OrderItemInstance_measurementId_idx" ON "OrderItemInstance"("measurementId");
CREATE INDEX "OrderItemInstance_productionStatus_archivedAt_idx" ON "OrderItemInstance"("productionStatus", "archivedAt");

INSERT INTO "OrderItemInstance" (
  "id", "orderItemId", "ordinal", "athleteId", "measurementId", "productionStatus", "createdAt", "updatedAt"
)
SELECT
  'legacy_' || md5(oi."id" || ':' || generated."ordinal"::text),
  oi."id",
  generated."ordinal",
  oi."athleteId",
  oi."measurementId",
  oi."productionStatus",
  oi."createdAt",
  oi."updatedAt"
FROM "OrderItem" AS oi
CROSS JOIN LATERAL generate_series(1, oi."quantity") AS generated("ordinal")
ON CONFLICT ("orderItemId", "ordinal") DO NOTHING;

ALTER TABLE "OrderItemInstance" ADD CONSTRAINT "OrderItemInstance_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItemInstance" ADD CONSTRAINT "OrderItemInstance_athleteId_fkey" FOREIGN KEY ("athleteId") REFERENCES "Athlete"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderItemInstance" ADD CONSTRAINT "OrderItemInstance_measurementId_fkey" FOREIGN KEY ("measurementId") REFERENCES "Measurement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
