-- Existing rows retain the legacy applied/order-currency representation (all NULL).
-- Same-currency and zero writes also clear the whole optional provenance group.
ALTER TABLE "OrderShipment"
  ADD COLUMN "customerChargeOriginalMinor" INTEGER,
  ADD COLUMN "customerChargeOriginalCurrency" TEXT,
  ADD COLUMN "customerChargeRateSnapshot" JSONB,
  ADD CONSTRAINT "OrderShipment_customerCharge_provenance_check" CHECK (
    ("customerChargeOriginalMinor" IS NULL
      AND "customerChargeOriginalCurrency" IS NULL
      AND "customerChargeRateSnapshot" IS NULL)
    OR
    ("customerChargeOriginalMinor" IS NOT NULL
      AND "customerChargeOriginalMinor" > 0
      AND "customerChargeOriginalCurrency" IS NOT NULL
      AND "customerChargeOriginalCurrency" IN ('EUR', 'USD', 'UAH')
      AND "customerChargeOriginalCurrency" <> "currency"
      AND "customerChargeRateSnapshot" IS NOT NULL
      AND jsonb_typeof("customerChargeRateSnapshot") = 'object')
  );
