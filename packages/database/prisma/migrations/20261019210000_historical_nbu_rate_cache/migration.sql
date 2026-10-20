BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
-- Cache state only: no network import, ledger change, activation or data rewrite.
CREATE TABLE "HistoricalNbuRate" (
 currency TEXT NOT NULL, "incomeDate" TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'NBU',
 status TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 1,
 "leaseToken" TEXT, "leaseUntil" TIMESTAMPTZ(3), "retryAt" TIMESTAMPTZ(3), "lastErrorCode" TEXT,
 numerator TEXT, denominator TEXT, "effectiveDate" TEXT, url TEXT, "fetchedAt" TIMESTAMPTZ(3), raw TEXT,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "HistoricalNbuRate_pkey" PRIMARY KEY (currency,"incomeDate"),
 CONSTRAINT historical_nbu_key CHECK (
  currency ~ '^[A-Z]{3}$' AND currency <> 'UAH' AND provider='NBU'
  AND "incomeDate" ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'
  AND "incomeDate"::date::text="incomeDate" AND attempts>=1
 ),
 CONSTRAINT historical_nbu_state CHECK (
  (status='READY' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL AND "retryAt" IS NULL AND "lastErrorCode" IS NULL
   AND numerator IS NOT NULL AND numerator ~ '^0*[1-9][0-9]*$' AND length(numerator)<=32000
   AND denominator IS NOT NULL AND denominator ~ '^0*[1-9][0-9]*$' AND length(denominator)<=32000
   AND "effectiveDate" IS NOT NULL AND "effectiveDate"="incomeDate"
   AND url IS NOT NULL AND url LIKE 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?%'
   AND "fetchedAt" IS NOT NULL AND raw IS NOT NULL AND length(raw) BETWEEN 1 AND 32000)
  OR
  (status IN ('PENDING','FAILED') AND numerator IS NULL AND denominator IS NULL
   AND "effectiveDate" IS NULL AND url IS NULL AND "fetchedAt" IS NULL AND raw IS NULL
   AND ((status='PENDING' AND "leaseToken" IS NOT NULL AND length("leaseToken") BETWEEN 16 AND 160
     AND "leaseUntil" IS NOT NULL AND "retryAt" IS NULL AND "lastErrorCode" IS NULL)
    OR (status='FAILED' AND "leaseToken" IS NULL AND "leaseUntil" IS NULL AND "retryAt" IS NOT NULL
     AND "lastErrorCode" IS NOT NULL AND "lastErrorCode"='NBU_UNAVAILABLE')))
 )
);
CREATE FUNCTION historical_nbu_immutable_ready() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='READY' THEN RAISE EXCEPTION 'Historical NBU READY evidence is immutable'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.currency<>OLD.currency OR NEW."incomeDate"<>OLD."incomeDate" OR NEW.provider<>OLD.provider THEN
  RAISE EXCEPTION 'Historical NBU lookup identity is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER historical_nbu_ready_guard BEFORE UPDATE OR DELETE ON "HistoricalNbuRate"
 FOR EACH ROW EXECUTE FUNCTION historical_nbu_immutable_ready();
COMMIT;
