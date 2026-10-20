CREATE TYPE "ShippingCarrier" AS ENUM ('NOVA_POSHTA','NOVA_GLOBAL','UKRPOSHTA','DHL');
CREATE TABLE "Shipment" ("id" TEXT NOT NULL,"orderId" TEXT NOT NULL,"carrier" "ShippingCarrier" NOT NULL,"trackingNumber" TEXT,"costMinor" INTEGER NOT NULL DEFAULT 0,"currency" TEXT NOT NULL,"shippedAt" TIMESTAMP(3),"deliveredAt" TIMESTAMP(3),"notes" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "Shipment_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "Shipment_orderId_key" ON "Shipment"("orderId");
CREATE INDEX "Shipment_carrier_trackingNumber_idx" ON "Shipment"("carrier","trackingNumber");
ALTER TABLE "Shipment" ADD CONSTRAINT "Shipment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
