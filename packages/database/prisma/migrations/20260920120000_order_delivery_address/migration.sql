ALTER TABLE "Order"
  ADD COLUMN "deliveryAddressSet" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "deliveryRecipient" TEXT,
  ADD COLUMN "deliveryAddressLine1" TEXT,
  ADD COLUMN "deliveryAddressLine2" TEXT,
  ADD COLUMN "deliveryCity" TEXT,
  ADD COLUMN "deliveryRegion" TEXT,
  ADD COLUMN "deliveryPostalCode" TEXT,
  ADD COLUMN "deliveryAddressText" TEXT;
