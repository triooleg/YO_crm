BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
-- Additive only. No activation, seed, historical rewrite, or existing column change.
CREATE TABLE "TaxPolicy" (
 "id" TEXT PRIMARY KEY,"effectiveFrom" TEXT NOT NULL,"group" INTEGER NOT NULL,
 "unifiedMode" TEXT NOT NULL,"unifiedRateBps" INTEGER NOT NULL,"fixedUnifiedMinor" BIGINT,
 "militaryRateBps" INTEGER NOT NULL,"esvRateBps" INTEGER NOT NULL,"state" TEXT NOT NULL DEFAULT 'PUBLISHED',
 "snapshot" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT tax_policy_rules CHECK ("group" IN(2,3) AND "unifiedMode" IN('PERCENT','FIXED') AND "unifiedRateBps" BETWEEN 0 AND 10000 AND "militaryRateBps" BETWEEN 0 AND 10000 AND "esvRateBps" BETWEEN 0 AND 10000 AND "state" IN('PUBLISHED','CANCELLED') AND ("unifiedMode"='PERCENT' OR ("fixedUnifiedMinor" IS NOT NULL AND "fixedUnifiedMinor">=0))),
 CONSTRAINT tax_policy_start CHECK ("effectiveFrom" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])-01$' AND "effectiveFrom">='2026-05-01')
);
CREATE UNIQUE INDEX tax_one_published_policy_date ON "TaxPolicy"("effectiveFrom") WHERE state='PUBLISHED';
CREATE TABLE "TaxPeriod" (
 "id" TEXT PRIMARY KEY,"month" TEXT NOT NULL UNIQUE,"policyId" TEXT NOT NULL REFERENCES "TaxPolicy"("id") ON DELETE RESTRICT,
 "state" TEXT NOT NULL DEFAULT 'OPEN',"revision" INTEGER NOT NULL DEFAULT 0,"snapshot" JSONB NOT NULL,
 "closedAt" TIMESTAMP(3),"closedSnapshot" JSONB,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT tax_period_shape CHECK ("month" ~ '^20[0-9]{2}-(0[1-9]|1[0-2])$' AND "month">='2026-05' AND "revision">=0 AND (("state"='OPEN' AND "closedAt" IS NULL AND "closedSnapshot" IS NULL) OR ("state"='CLOSED' AND "closedAt" IS NOT NULL AND "closedSnapshot" IS NOT NULL)))
);
CREATE TABLE "TaxEntry" (
 sequence BIGSERIAL NOT NULL UNIQUE,
 "id" TEXT PRIMARY KEY,"periodId" TEXT NOT NULL REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT,
 "originalPeriodId" TEXT REFERENCES "TaxPeriod"("id") ON DELETE RESTRICT,"policyId" TEXT NOT NULL REFERENCES "TaxPolicy"("id") ON DELETE RESTRICT,
 "paymentId" TEXT REFERENCES "Payment"("id") ON DELETE RESTRICT,"orderId" TEXT REFERENCES "Order"("id") ON DELETE RESTRICT,
 "component" TEXT NOT NULL,"kind" TEXT NOT NULL,"rootId" TEXT REFERENCES "TaxEntry"("id") ON DELETE RESTRICT,
 "reversesEntryId" TEXT REFERENCES "TaxEntry"("id") ON DELETE RESTRICT,"sourceKey" TEXT UNIQUE,
 "operationKey" TEXT NOT NULL UNIQUE,"payloadHash" TEXT NOT NULL,"amountMinor" BIGINT,"baseMinor" BIGINT,
 "snapshot" JSONB NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT tax_entry_component CHECK ("component" IN('UNIFIED','MILITARY','ESV')),
 CONSTRAINT tax_entry_shape CHECK (
 ("kind"='ROOT' AND "sourceKey" IS NOT NULL AND "rootId" IS NULL AND "amountMinor" IS NULL) OR
 ("kind" IN('SOURCE','RESOLVE') AND "rootId" IS NOT NULL AND "sourceKey" IS NULL AND "amountMinor" IS NULL) OR
 ("kind" IN('FINALIZE','REVERSE','RESTORE','ADJUST','DRAFT') AND "rootId" IS NOT NULL AND "sourceKey" IS NULL AND "amountMinor" IS NOT NULL)),
 CONSTRAINT tax_entry_safe CHECK (("amountMinor" IS NULL OR "amountMinor" BETWEEN -9007199254740991 AND 9007199254740991) AND ("baseMinor" IS NULL OR "baseMinor" BETWEEN 0 AND 9007199254740991))
);
CREATE INDEX "TaxEntry_periodId_component_createdAt_idx" ON "TaxEntry"("periodId","component","createdAt");
CREATE INDEX "TaxEntry_rootId_createdAt_idx" ON "TaxEntry"("rootId","createdAt");
CREATE INDEX "TaxEntry_paymentId_createdAt_idx" ON "TaxEntry"("paymentId","createdAt");
CREATE UNIQUE INDEX tax_one_finalize ON "TaxEntry"("rootId") WHERE "kind"='FINALIZE';
CREATE UNIQUE INDEX tax_one_draft_publish ON "TaxEntry"("reversesEntryId") WHERE "kind"='ADJUST' AND "reversesEntryId" IS NOT NULL;
CREATE TABLE "TaxExpenseAllocation" (
 sequence BIGSERIAL NOT NULL UNIQUE,
 "id" TEXT PRIMARY KEY,"kind" TEXT NOT NULL,"expenseId" TEXT NOT NULL REFERENCES "Expense"("id") ON DELETE RESTRICT,
 "linkId" TEXT REFERENCES "TaxExpenseAllocation"("id") ON DELETE RESTRICT,"rootId" TEXT REFERENCES "TaxEntry"("id") ON DELETE RESTRICT,
 "reversesId" TEXT REFERENCES "TaxExpenseAllocation"("id") ON DELETE RESTRICT,"component" TEXT NOT NULL,"amountMinor" BIGINT NOT NULL,
 "incurredAt" TIMESTAMP(3) NOT NULL,"snapshot" JSONB NOT NULL,"operationKey" TEXT NOT NULL UNIQUE,"payloadHash" TEXT NOT NULL,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT tax_allocation_component CHECK ("component" IN('UNIFIED','MILITARY','ESV')),
 CONSTRAINT tax_allocation_shape CHECK (
 ("kind"='PAYMENT_LINK' AND "linkId" IS NULL AND "rootId" IS NULL AND "reversesId" IS NULL AND "amountMinor">0) OR
 ("kind"='ALLOCATE' AND "linkId" IS NOT NULL AND "rootId" IS NOT NULL AND "reversesId" IS NULL AND "amountMinor">0) OR
 ("kind"='REVERSE_ALLOCATION' AND "linkId" IS NOT NULL AND "rootId" IS NOT NULL AND "reversesId" IS NOT NULL AND "amountMinor">0) OR
 ("kind"='CORRECT_LINK' AND "linkId" IS NOT NULL AND "rootId" IS NULL AND "amountMinor">=0)),
 CONSTRAINT tax_allocation_safe CHECK ("amountMinor"<=9007199254740991)
);
CREATE INDEX "TaxExpenseAllocation_rootId_idx" ON "TaxExpenseAllocation"("rootId");
CREATE INDEX "TaxExpenseAllocation_expenseId_createdAt_idx" ON "TaxExpenseAllocation"("expenseId","createdAt");
CREATE UNIQUE INDEX tax_expense_one_link ON "TaxExpenseAllocation"("expenseId") WHERE "kind"='PAYMENT_LINK';
CREATE UNIQUE INDEX tax_allocation_one_reverse ON "TaxExpenseAllocation"("reversesId") WHERE "kind"='REVERSE_ALLOCATION';
CREATE FUNCTION tax_no_mutation() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Tax ledger is append-only'; END $$;
CREATE TRIGGER tax_entry_immutable BEFORE UPDATE OR DELETE ON "TaxEntry" FOR EACH ROW EXECUTE FUNCTION tax_no_mutation();
CREATE TRIGGER tax_allocation_immutable BEFORE UPDATE OR DELETE ON "TaxExpenseAllocation" FOR EACH ROW EXECUTE FUNCTION tax_no_mutation();
CREATE FUNCTION tax_policy_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tax policy history is immutable'; END IF;
 IF (to_jsonb(OLD)-'state') IS DISTINCT FROM (to_jsonb(NEW)-'state') OR OLD."state"='CANCELLED' OR NEW."state"<>'CANCELLED' OR EXISTS(SELECT 1 FROM "TaxPeriod" WHERE "policyId"=OLD.id) THEN RAISE EXCEPTION 'Tax policy already used or immutable'; END IF;
 RETURN NEW;
 END $$;
CREATE TRIGGER tax_policy_immutable BEFORE UPDATE OR DELETE ON "TaxPolicy" FOR EACH ROW EXECUTE FUNCTION tax_policy_guard();
CREATE FUNCTION tax_period_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Tax period history is immutable'; END IF;
 IF OLD."state"='CLOSED' OR NEW."policyId"<>OLD."policyId" OR NEW."month"<>OLD."month" OR NEW."snapshot"<>OLD."snapshot" OR NEW."revision"<>OLD."revision"+1 THEN RAISE EXCEPTION 'Tax period immutable or revision conflict'; END IF;
 RETURN NEW;
 END $$;
CREATE TRIGGER tax_period_immutable BEFORE UPDATE OR DELETE ON "TaxPeriod" FOR EACH ROW EXECUTE FUNCTION tax_period_guard();
-- Cross-row references and caps are checked under the same config lock used by
-- hooks, policy publication, allocation and closure. DB guard also protects raw SQL callers.
CREATE FUNCTION tax_allocation_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE l "TaxExpenseAllocation"; r "TaxEntry"; a "TaxExpenseAllocation"; used BIGINT; cap BIGINT; debt BIGINT;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('tax-config'));
 IF NEW.kind='PAYMENT_LINK' THEN
  IF NOT EXISTS(SELECT 1 FROM "Expense" e WHERE e.id=NEW."expenseId" AND e.currency='UAH' AND e."archivedAt" IS NULL AND e."orderId" IS NULL AND e."amountMinor"=NEW."amountMinor" AND e."incurredAt"=NEW."incurredAt" AND NOT EXISTS(SELECT 1 FROM "OrderShipment" s WHERE s."atelierExpenseId"=e.id)) THEN RAISE EXCEPTION 'Tax expense must be active unbound UAH'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO l FROM "TaxExpenseAllocation" WHERE id=NEW."linkId" AND kind='PAYMENT_LINK';
 IF l.id IS NULL OR l."expenseId"<>NEW."expenseId" OR l.component<>NEW.component THEN RAISE EXCEPTION 'Invalid tax payment link'; END IF;
 IF NEW.kind='CORRECT_LINK' THEN RETURN NEW; END IF;
 SELECT * INTO r FROM "TaxEntry" WHERE id=NEW."rootId" AND kind='ROOT';
 IF r.id IS NULL OR r.component<>NEW.component THEN RAISE EXCEPTION 'Invalid tax allocation target'; END IF;
 IF NEW.kind='REVERSE_ALLOCATION' THEN
  SELECT * INTO a FROM "TaxExpenseAllocation" WHERE id=NEW."reversesId" AND kind='ALLOCATE';
  IF a.id IS NULL OR a."linkId"<>NEW."linkId" OR a."rootId"<>NEW."rootId" OR a."amountMinor"<>NEW."amountMinor" THEN RAISE EXCEPTION 'Invalid allocation reversal'; END IF;
  RETURN NEW;
 END IF;
 SELECT COALESCE((SELECT "amountMinor" FROM "TaxExpenseAllocation" WHERE "linkId"=l.id AND kind='CORRECT_LINK' ORDER BY sequence DESC LIMIT 1),l."amountMinor") INTO cap;
 SELECT COALESCE(SUM(CASE kind WHEN 'ALLOCATE' THEN "amountMinor" WHEN 'REVERSE_ALLOCATION' THEN -"amountMinor" ELSE 0 END),0) INTO used FROM "TaxExpenseAllocation" WHERE "linkId"=l.id;
 IF used+NEW."amountMinor">cap THEN RAISE EXCEPTION 'Tax payment overallocated'; END IF;
 SELECT COALESCE(SUM("amountMinor"),0) INTO debt FROM "TaxEntry" WHERE "rootId"=r.id AND kind IN('FINALIZE','REVERSE','RESTORE','ADJUST');
 SELECT COALESCE(SUM(CASE kind WHEN 'ALLOCATE' THEN "amountMinor" WHEN 'REVERSE_ALLOCATION' THEN -"amountMinor" ELSE 0 END),0) INTO used FROM "TaxExpenseAllocation" WHERE "rootId"=r.id;
 IF used+NEW."amountMinor">debt THEN RAISE EXCEPTION 'Tax obligation overallocated'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tax_allocation_consistency BEFORE INSERT ON "TaxExpenseAllocation" FOR EACH ROW EXECUTE FUNCTION tax_allocation_guard();
CREATE FUNCTION tax_entry_guard() RETURNS TRIGGER LANGUAGE plpgsql AS $$ DECLARE r "TaxEntry"; BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('tax-config'));
 IF NEW.kind='ROOT' THEN
  IF NEW."paymentId" IS NOT NULL AND NEW."sourceKey"<>'payment:'||NEW."paymentId"||':'||NEW.component THEN RAISE EXCEPTION 'Invalid tax source key'; END IF;
  IF NEW."paymentId" IS NULL AND NEW."sourceKey"<>'month:'||(SELECT month FROM "TaxPeriod" WHERE id=NEW."periodId")||':'||NEW.component THEN RAISE EXCEPTION 'Invalid monthly tax source'; END IF;
 ELSE
  SELECT * INTO r FROM "TaxEntry" WHERE id=NEW."rootId" AND kind='ROOT';
  IF r.id IS NULL OR r.component<>NEW.component OR r."policyId"<>NEW."policyId" OR r."paymentId" IS DISTINCT FROM NEW."paymentId" OR r."orderId" IS DISTINCT FROM NEW."orderId" THEN RAISE EXCEPTION 'Tax event does not match root'; END IF;
 END IF;
 IF NEW.kind IN('FINALIZE','REVERSE','RESTORE','ADJUST') AND EXISTS(SELECT 1 FROM "TaxPeriod" WHERE id=NEW."periodId" AND state='CLOSED') THEN RAISE EXCEPTION 'Tax closed period cannot change'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER tax_entry_consistency BEFORE INSERT ON "TaxEntry" FOR EACH ROW EXECUTE FUNCTION tax_entry_guard();
COMMIT;
