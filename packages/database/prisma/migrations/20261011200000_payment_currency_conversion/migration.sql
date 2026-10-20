ALTER TABLE "Payment"
ADD COLUMN "appliedAmountMinor" INTEGER,
ADD COLUMN "appliedCurrency" TEXT,
ADD COLUMN "exchangeRateSnapshot" JSONB;
