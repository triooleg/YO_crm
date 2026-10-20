BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';

-- Additive formula metadata only; no policy publication or history rewrite.
ALTER TABLE "TaxPolicy" ADD COLUMN "fixedUnifiedWageRateBps" INTEGER;
ALTER TABLE "TaxPolicy" DROP CONSTRAINT tax_policy_rules;
ALTER TABLE "TaxPolicy" ADD CONSTRAINT tax_policy_rules CHECK (
 "group" IN (2,3)
 AND "unifiedMode" IN ('PERCENT','FIXED')
 AND "unifiedRateBps" BETWEEN 0 AND 10000
 AND "militaryRateBps" BETWEEN 0 AND 10000
 AND "esvRateBps" BETWEEN 0 AND 10000
 AND "state" IN ('PUBLISHED','CANCELLED')
 AND (
  -- Preserve every previously accepted branch when the new field is NULL.
  ("fixedUnifiedWageRateBps" IS NULL AND (
   "unifiedMode" = 'PERCENT'
   OR ("fixedUnifiedMinor" IS NOT NULL AND "fixedUnifiedMinor" >= 0)
  ))
  OR (
   "fixedUnifiedWageRateBps" IS NOT NULL
   AND "group" = 2 AND "unifiedMode" = 'FIXED'
   AND "unifiedRateBps" = 0 AND "fixedUnifiedMinor" IS NULL
   AND "fixedUnifiedWageRateBps" BETWEEN 1 AND 2000
  )
 )
);
COMMIT;
