CREATE TABLE "OrderShipment" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "carrier" "ShippingCarrier" NOT NULL,
  "status" "ShippingStatus" NOT NULL DEFAULT 'NOT_READY', "trackingNumber" TEXT,
  "customerChargeMinor" INTEGER NOT NULL DEFAULT 0, "atelierCostMinor" INTEGER NOT NULL DEFAULT 0,
  "atelierExpenseId" TEXT, "currency" TEXT NOT NULL, "weightGrams" INTEGER,
  "lengthMm" INTEGER, "widthMm" INTEGER, "heightMm" INTEGER,
  "isPrimary" BOOLEAN NOT NULL DEFAULT false, "shippedAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3),
  "serviceName" TEXT, "externalServiceId" TEXT, "externalStatus" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  "archivedAt" TIMESTAMP(3), CONSTRAINT "OrderShipment_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "OrderItemInstance" ADD COLUMN "orderShipmentId" TEXT;
CREATE UNIQUE INDEX "OrderShipment_atelierExpenseId_key" ON "OrderShipment"("atelierExpenseId");
CREATE INDEX "OrderShipment_orderId_archivedAt_idx" ON "OrderShipment"("orderId", "archivedAt");
CREATE INDEX "OrderShipment_carrier_trackingNumber_idx" ON "OrderShipment"("carrier", "trackingNumber");
CREATE UNIQUE INDEX "OrderShipment_one_primary_per_order_key" ON "OrderShipment"("orderId") WHERE "isPrimary" = true AND "archivedAt" IS NULL;
CREATE INDEX "OrderItemInstance_orderShipmentId_idx" ON "OrderItemInstance"("orderShipmentId");

INSERT INTO "OrderShipment" (
  "id","orderId","carrier","status","trackingNumber","customerChargeMinor","currency",
  "isPrimary","shippedAt","deliveredAt","serviceName","externalServiceId","externalStatus","createdAt","updatedAt"
)
SELECT 'legacy_' || md5(s."id"), s."orderId", s."carrier", o."shippingStatus", s."trackingNumber",
  s."costMinor", s."currency", true, s."shippedAt", s."deliveredAt", s."serviceName",
  s."externalServiceId", s."externalStatus", s."createdAt", s."updatedAt"
FROM "Shipment" s JOIN "Order" o ON o."id" = s."orderId"
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "OrderShipment" ADD CONSTRAINT "OrderShipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderShipment" ADD CONSTRAINT "OrderShipment_atelierExpenseId_fkey" FOREIGN KEY ("atelierExpenseId") REFERENCES "Expense"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "OrderItemInstance" ADD CONSTRAINT "OrderItemInstance_orderShipmentId_fkey" FOREIGN KEY ("orderShipmentId") REFERENCES "OrderShipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
