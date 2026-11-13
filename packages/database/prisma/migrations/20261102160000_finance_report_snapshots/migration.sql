BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
SET LOCAL search_path = pg_catalog, public;

-- finance-snapshot-v1. Additive derivative storage only; no source/history rewrite.
CREATE TABLE public."FinanceReportRevision" (
  key TEXT PRIMARY KEY,
  revision BIGINT NOT NULL DEFAULT 0
);
-- The read engine requires every dependency row to exist. Establish the complete
-- supported calendar without touching business data; per-order keys are still
-- created only by source mutations. Missing rows later remain a cache bypass.
INSERT INTO public."FinanceReportRevision" (key)
SELECT key FROM (VALUES ('epoch'),('orders'),('metadata'),('settings'),('tax-global'),('fx-global')) globals(key)
UNION ALL
SELECT scope||':'||to_char(period,'YYYY-MM')
FROM generate_series(TIMESTAMP '1900-01-01',TIMESTAMP '2199-12-01',INTERVAL '1 month') AS period
CROSS JOIN (VALUES ('month'),('tax'),('fx')) scopes(scope);

CREATE TABLE public."FinancePeriodSnapshot" (
  key TEXT PRIMARY KEY,
  period TEXT NOT NULL,
  scope TEXT NOT NULL,
  "sourceRevision" TEXT NOT NULL,
  "calculationVersion" TEXT NOT NULL,
  "taxPolicyVersion" TEXT NOT NULL,
  "fxVersion" TEXT NOT NULL,
  "calculatedAt" TIMESTAMPTZ(3) NOT NULL,
  status TEXT NOT NULL,
  payload JSONB,
  checksum TEXT,
  "leaseToken" TEXT,
  "leaseUntil" TIMESTAMPTZ(3),
  CONSTRAINT finance_snapshot_status CHECK (status IN ('READY','DIRTY','CALCULATING','FAILED'))
);
CREATE TABLE public."FinanceReportCacheRow" (
  "snapshotKey" TEXT NOT NULL,
  kind TEXT NOT NULL,
  id TEXT NOT NULL,
  payload JSONB NOT NULL,
  ordinal INTEGER NOT NULL,
  CONSTRAINT "FinanceReportCacheRow_pkey" PRIMARY KEY ("snapshotKey",kind,id),
  CONSTRAINT "FinanceReportCacheRow_snapshotKey_fkey" FOREIGN KEY ("snapshotKey")
    REFERENCES public."FinancePeriodSnapshot"(key) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "FinanceReportCacheRow_snapshotKey_kind_ordinal_idx"
  ON public."FinanceReportCacheRow" ("snapshotKey",kind,ordinal);

-- Atomic increments roll back with source writes. Sorted keys reduce lock inversions.
CREATE FUNCTION public.yo_finance_cache_bump(keys TEXT[]) RETURNS VOID
LANGUAGE sql SET search_path = pg_catalog, public AS $$
  INSERT INTO public."FinanceReportRevision" AS r (key,revision)
  SELECT DISTINCT k,1 FROM unnest(keys) AS k WHERE k IS NOT NULL ORDER BY k
  ON CONFLICT (key) DO UPDATE SET revision=r.revision+1;
$$;

-- Prisma business timestamps are timestamp-without-time-zone containing UTC.
-- Never let the session timezone reinterpret them.
CREATE FUNCTION public.yo_finance_cache_months(value TIMESTAMP) RETURNS TEXT[]
LANGUAGE sql SET search_path = pg_catalog, public AS $$
  SELECT CASE WHEN value IS NULL THEN ARRAY[]::TEXT[] ELSE ARRAY[
    'month:'||to_char(value,'YYYY-MM'),
    'month:'||to_char(value AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv','YYYY-MM')
  ] END;
$$;

CREATE FUNCTION public.yo_finance_cache_tax_keys(roots TEXT[], periods TEXT[]) RETURNS TEXT[]
LANGUAGE sql SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(array_agg(DISTINCT 'tax:'||p.month),ARRAY[]::TEXT[])
  FROM public."TaxPeriod" p WHERE p.id=ANY(periods) OR p.id IN (
    SELECT e."periodId" FROM public."TaxEntry" e WHERE e.id=ANY(roots) OR e."rootId"=ANY(roots)
    UNION SELECT e."originalPeriodId" FROM public."TaxEntry" e WHERE e.id=ANY(roots) OR e."rootId"=ANY(roots)
  );
$$;

CREATE FUNCTION public.yo_finance_cache_source() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  before_row JSONB := CASE WHEN TG_OP IN ('UPDATE','DELETE') THEN to_jsonb(OLD) ELSE '{}'::JSONB END;
  after_row JSONB := CASE WHEN TG_OP IN ('UPDATE','INSERT') THEN to_jsonb(NEW) ELSE '{}'::JSONB END;
  item JSONB; keys TEXT[] := ARRAY[]::TEXT[]; order_ids TEXT[] := ARRAY[]::TEXT[];
  projection_order_ids TEXT[] := ARRAY[]::TEXT[]; order_projection_changed BOOLEAN := FALSE;
  roots TEXT[] := ARRAY[]::TEXT[]; periods TEXT[] := ARRAY[]::TEXT[];
  order_id TEXT; field TEXT; source_before JSONB; source_after JSONB;
BEGIN
  IF TG_OP='UPDATE' AND before_row-'updatedAt' = after_row-'updatedAt' THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME='Order' THEN
    -- Debt/status/deadline/production facts belong to orders, not historical
    -- monthly cash. Only membership and row/source identity fan out to cash.
    order_projection_changed=TG_OP<>'UPDATE' OR
      jsonb_build_array(before_row->'id',before_row->'archivedAt',before_row->'clientId',before_row->'number',
        before_row->'sourceSystem',before_row->'sourceAccount',before_row->'sourceLinkMode',before_row->'externalId',
        before_row#>'{externalData,source_id}',before_row#>'{externalData,contractVersion}') IS DISTINCT FROM
      jsonb_build_array(after_row->'id',after_row->'archivedAt',after_row->'clientId',after_row->'number',
        after_row->'sourceSystem',after_row->'sourceAccount',after_row->'sourceLinkMode',after_row->'externalId',
        after_row#>'{externalData,source_id}',after_row#>'{externalData,contractVersion}');
  END IF;
  IF TG_TABLE_NAME='Client' AND TG_OP='UPDATE' AND
    jsonb_build_array(before_row->'id',before_row->'displayName',before_row->'source') IS NOT DISTINCT FROM
    jsonb_build_array(after_row->'id',after_row->'displayName',after_row->'source') THEN
    -- Inbox contact timestamps, telephone/email and preferences are not finance
    -- inputs. Message activity must not invalidate unchanged financial reports.
    RETURN NULL;
  END IF;
  IF TG_TABLE_NAME='Activity' THEN
    -- Only these four event types participate in order-source classification.
    IF before_row->>'type' IN ('ORDER_SOURCE_OVERRIDDEN','KEYCRM_ORDER_IMPORTED','KEYCRM_ORDER_SYNCED','ORDER_CREATED') THEN
      source_before=jsonb_build_array(before_row->'id',before_row->'orderId',before_row->'type',before_row->'createdAt',
        before_row#>'{metadata,source}',before_row#>'{metadata,keycrmOrderId}',before_row#>'{metadata,sourceName}');
    END IF;
    IF after_row->>'type' IN ('ORDER_SOURCE_OVERRIDDEN','KEYCRM_ORDER_IMPORTED','KEYCRM_ORDER_SYNCED','ORDER_CREATED') THEN
      source_after=jsonb_build_array(after_row->'id',after_row->'orderId',after_row->'type',after_row->'createdAt',
        after_row#>'{metadata,source}',after_row#>'{metadata,keycrmOrderId}',after_row#>'{metadata,sourceName}');
    END IF;
    IF source_before IS NOT DISTINCT FROM source_after THEN RETURN NULL; END IF;
    IF source_before IS NULL THEN before_row='{}'; END IF;
    IF source_after IS NULL THEN after_row='{}'; END IF;
  END IF;

  FOR item IN SELECT before_row UNION SELECT after_row LOOP
    IF item='{}'::JSONB THEN CONTINUE; END IF;
    CASE TG_TABLE_NAME
      WHEN 'AppSetting' THEN
        IF item->>'section'='taxes' AND item->>'key'='config' THEN keys=array_append(keys,'tax-global');
        ELSIF item->>'section'='finance' AND item->>'key' IN ('exchangeRateProvider','exchangeRateCache') THEN keys=array_append(keys,'settings');
        END IF;
      WHEN 'HistoricalNbuRate' THEN
        -- Composite reports can value posting dates outside their visible
        -- window. Children still depend on their exact fx months/evidence.
        keys=array_append(keys,'fx-global');
        SELECT keys||array_agg(DISTINCT 'fx:'||to_char(d,'YYYY-MM')) INTO keys
        FROM generate_series((item->>'incomeDate')::DATE::TIMESTAMP,
          (item->>'incomeDate')::DATE+INTERVAL '31 days',INTERVAL '1 day') AS d;
      WHEN 'Client' THEN
        -- Client creation/contact facts change global options/statistics. Only
        -- a changed label already referenced by an order dirties old row labels.
        keys=array_append(keys,'orders');
        IF TG_OP='UPDATE' AND (
            before_row->'displayName' IS DISTINCT FROM after_row->'displayName'
            OR before_row->'id' IS DISTINCT FROM after_row->'id')
          AND EXISTS(SELECT 1 FROM public."Order" o WHERE o."clientId"=ANY(ARRAY[before_row->>'id',after_row->>'id'])) THEN
          keys=array_append(keys,'metadata');
        END IF;
      WHEN 'ClientMergeRedirect' THEN
        -- Canonical merge identity affects shared sales facts and row metadata.
        keys=keys||ARRAY['orders','metadata'];
      WHEN 'ExpenseCategory' THEN keys=array_append(keys,'metadata');
      WHEN 'OrderItem' THEN
        -- Quantity/design/archive/production facts change sales statistics but
        -- do not alter cash receipts or fiscal monthly liabilities.
        keys=array_append(keys,'orders');
        order_ids=array_append(order_ids,item->>'orderId');
      WHEN 'OrderItemInstance' THEN
        -- Instance/archive identity affects the statistics integrity warnings.
        keys=array_append(keys,'orders');
      WHEN 'TaxPolicy' THEN keys=array_append(keys,'tax-global');
      WHEN 'TaxPeriod' THEN
        keys=array_append(keys,'tax:'||(item->>'month'));
        -- A period's close affects roots also represented in other posting months.
        SELECT roots||COALESCE(array_agg(DISTINCT COALESCE(e."rootId",e.id)),ARRAY[]::TEXT[]) INTO roots
        FROM public."TaxEntry" e WHERE e."periodId"=item->>'id' OR e."originalPeriodId"=item->>'id';
      WHEN 'TaxEntry' THEN
        roots=array_append(roots,COALESCE(item->>'rootId',item->>'id'));
        periods=periods||ARRAY[item->>'periodId',item->>'originalPeriodId'];
        IF item->>'orderId' IS NOT NULL THEN keys=array_append(keys,'order:'||(item->>'orderId')); END IF;
      WHEN 'TaxExpenseAllocation' THEN
        keys=array_append(keys,'tax-global');
        roots=array_append(roots,item->>'rootId');
        keys=keys||public.yo_finance_cache_months((item->>'incurredAt')::TIMESTAMP);
        SELECT roots||COALESCE(array_agg(DISTINCT a."rootId"),ARRAY[]::TEXT[]) INTO roots
        FROM public."TaxExpenseAllocation" a WHERE a."expenseId"=item->>'expenseId';
      WHEN 'Order','Payment','Expense','Invoice','OrderShipment','ProductionSlot','Activity' THEN
        order_id=CASE WHEN TG_TABLE_NAME='Order' THEN item->>'id' ELSE item->>'orderId' END;
        IF order_id IS NOT NULL THEN
          order_ids=array_append(order_ids,order_id);
          IF TG_TABLE_NAME='Activity' OR order_projection_changed THEN
            projection_order_ids=array_append(projection_order_ids,order_id);
          END IF;
        END IF;
        keys=array_append(keys,'orders');
        IF TG_TABLE_NAME='Activity' AND order_id IS NULL THEN keys=array_append(keys,'epoch'); END IF;
        FOREACH field IN ARRAY CASE TG_TABLE_NAME
          WHEN 'Payment' THEN ARRAY['receivedAt'] WHEN 'Expense' THEN ARRAY['incurredAt']
          WHEN 'Invoice' THEN ARRAY['issueDate','dueDate']
          ELSE ARRAY[]::TEXT[] END LOOP
          keys=keys||public.yo_finance_cache_months((item->>field)::TIMESTAMP);
          IF TG_TABLE_NAME='Payment' AND item->>field IS NOT NULL THEN
            keys=array_append(keys,'tax:'||to_char((item->>field)::TIMESTAMP AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Kyiv','YYYY-MM'));
          END IF;
        END LOOP;
        IF TG_TABLE_NAME='Payment' THEN
          -- A receipt only touches its own tax roots, never other receipts of
          -- the same order. New-month deposits must preserve old month caches.
          SELECT roots||COALESCE(array_agg(DISTINCT COALESCE(e."rootId",e.id)),ARRAY[]::TEXT[]) INTO roots
          FROM public."TaxEntry" e WHERE e."paymentId"=item->>'id';
        END IF;
        IF TG_TABLE_NAME='Expense' AND EXISTS(SELECT 1 FROM public."TaxExpenseAllocation" a WHERE a."expenseId"=item->>'id') THEN
          keys=array_append(keys,'tax-global');
          SELECT roots||COALESCE(array_agg(DISTINCT a."rootId"),ARRAY[]::TEXT[]) INTO roots
          FROM public."TaxExpenseAllocation" a WHERE a."expenseId"=item->>'id';
        END IF;
        IF TG_TABLE_NAME='OrderShipment' AND (TG_OP<>'UPDATE'
            OR before_row->'atelierExpenseId' IS DISTINCT FROM after_row->'atelierExpenseId'
            OR before_row->'id' IS DISTINCT FROM after_row->'id') THEN
          -- Expense rows expose shipment identity; ordinary shipment status or
          -- charge edits do not change that relationship or old cash amounts.
          SELECT keys||COALESCE(array_agg(k),ARRAY[]::TEXT[]) INTO keys FROM (
            SELECT unnest(public.yo_finance_cache_months(e."incurredAt")) k
            FROM public."Expense" e WHERE e.id=item->>'atelierExpenseId'
          ) linked_expense;
        END IF;
      ELSE keys=array_append(keys,'epoch');
    END CASE;
  END LOOP;

  FOR order_id IN SELECT DISTINCT id FROM unnest(order_ids) id WHERE id IS NOT NULL ORDER BY id LOOP
    keys=array_append(keys,'order:'||order_id);
  END LOOP;
  -- Fan out only membership, identity and source-classification changes.
  FOR order_id IN SELECT DISTINCT id FROM unnest(projection_order_ids) id WHERE id IS NOT NULL ORDER BY id LOOP
    SELECT keys||COALESCE(array_agg(k),ARRAY[]::TEXT[]) INTO keys FROM (
      SELECT unnest(public.yo_finance_cache_months(p."receivedAt")) k FROM public."Payment" p WHERE p."orderId"=order_id
      UNION SELECT unnest(public.yo_finance_cache_months(e."incurredAt")) FROM public."Expense" e WHERE e."orderId"=order_id
      UNION SELECT unnest(public.yo_finance_cache_months(i."issueDate")) FROM public."Invoice" i WHERE i."orderId"=order_id
    ) connected;
    SELECT roots||COALESCE(array_agg(DISTINCT COALESCE(e."rootId",e.id)),ARRAY[]::TEXT[]) INTO roots
    FROM public."TaxEntry" e WHERE e."orderId"=order_id;
  END LOOP;
  keys=keys||public.yo_finance_cache_tax_keys(roots,periods);
  PERFORM public.yo_finance_cache_bump(keys);
  RETURN NULL;
END;
$$;

CREATE FUNCTION public.yo_finance_cache_truncate() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  PERFORM public.yo_finance_cache_bump(ARRAY['epoch']);
  RETURN NULL;
END;
$$;

DO $$
DECLARE source TEXT;
BEGIN
  FOREACH source IN ARRAY ARRAY['Order','Payment','Expense','Invoice','OrderShipment','ProductionSlot','Activity',
    'Client','ExpenseCategory','TaxPolicy','TaxPeriod','TaxEntry','TaxExpenseAllocation','AppSetting','HistoricalNbuRate',
    'OrderItem','OrderItemInstance','ClientMergeRedirect'] LOOP
    EXECUTE format('CREATE TRIGGER yo_finance_cache_row AFTER INSERT OR UPDATE OR DELETE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.yo_finance_cache_source()',source);
    EXECUTE format('CREATE TRIGGER yo_finance_cache_truncate AFTER TRUNCATE ON public.%I FOR EACH STATEMENT EXECUTE FUNCTION public.yo_finance_cache_truncate()',source);
    -- ALWAYS also covers session_replication_role=replica import paths.
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER yo_finance_cache_row',source);
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER yo_finance_cache_truncate',source);
  END LOOP;
END;
$$;

-- Freeze the installed definitions into the checker itself, not a writable
-- manifest table. Drift (including added overloads) disables durable reuse.
DO $install$
DECLARE manifest JSONB; body TEXT; self_hash TEXT;
BEGIN
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND starts_with(p.proname,'yo_finance_cache_')) <> 5
    OR (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND starts_with(t.tgname,'yo_finance_cache_')) <> 36 THEN
    RAISE EXCEPTION 'Unexpected finance-snapshot-v1 functions or triggers';
  END IF;
  SELECT jsonb_build_object(
    'functions',(SELECT jsonb_agg(jsonb_build_object('name',p.proname,
      'arguments',pg_get_function_identity_arguments(p.oid),'digest',md5(pg_get_functiondef(p.oid))) ORDER BY p.proname)
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND starts_with(p.proname,'yo_finance_cache_')),
    'triggers',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',t.tgname,
      'digest',md5(pg_get_triggerdef(t.oid))) ORDER BY c.relname,t.tgname)
      FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND starts_with(t.tgname,'yo_finance_cache_')),
    'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'digest',(
      SELECT md5(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::TEXT,',' ORDER BY a.attnum))
      FROM pg_attribute a WHERE a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped)) ORDER BY c.relname)
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r'
      AND c.relname IN ('Order','Payment','Expense','Invoice','OrderShipment','ProductionSlot','Activity','Client','ExpenseCategory',
        'TaxPolicy','TaxPeriod','TaxEntry','TaxExpenseAllocation','AppSetting','HistoricalNbuRate','OrderItem','OrderItemInstance','ClientMergeRedirect',
        'FinanceReportRevision','FinancePeriodSnapshot','FinanceReportCacheRow'))
  ) INTO manifest;

  body=format($body$
-- finance-snapshot-v1
-- self-md5:00000000000000000000000000000000
DECLARE expected JSONB := %L::JSONB; item JSONB; object_id OID; digest TEXT; self_definition TEXT;
BEGIN
  IF obj_description('public.yo_finance_cache_coverage()'::regprocedure,'pg_proc') IS DISTINCT FROM 'finance-snapshot-v1' THEN RETURN FALSE; END IF;
  self_definition=pg_get_functiondef('public.yo_finance_cache_coverage()'::regprocedure);
  IF md5(regexp_replace(self_definition,'-- self-md5:'||'[0-9a-f]{32}',
      '-- self-md5:'||repeat('0',32),'g')) IS DISTINCT FROM
      substring(self_definition FROM '-- self-md5:'||'([0-9a-f]{32})') THEN RETURN FALSE; END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND starts_with(p.proname,'yo_finance_cache_'))
      <> jsonb_array_length(expected->'functions')+1 THEN RETURN FALSE; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(expected->'functions') LOOP
    SELECT p.oid INTO object_id FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname=item->>'name' AND pg_get_function_identity_arguments(p.oid)=item->>'arguments';
    IF object_id IS NULL OR md5(pg_get_functiondef(object_id)) IS DISTINCT FROM item->>'digest' THEN RETURN FALSE; END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname='public' AND starts_with(t.tgname,'yo_finance_cache_'))
      <> jsonb_array_length(expected->'triggers') THEN RETURN FALSE; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(expected->'triggers') LOOP
    SELECT t.oid INTO object_id FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=item->>'table' AND t.tgname=item->>'name' AND t.tgenabled='A' AND NOT t.tgisinternal;
    IF object_id IS NULL OR md5(pg_get_triggerdef(object_id)) IS DISTINCT FROM item->>'digest' THEN RETURN FALSE; END IF;
  END LOOP;
  FOR item IN SELECT value FROM jsonb_array_elements(expected->'tables') LOOP
    SELECT c.oid INTO object_id FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relname=item->>'name' AND c.relkind='r' AND c.relpersistence='p';
    IF object_id IS NULL THEN RETURN FALSE; END IF;
    SELECT md5(string_agg(a.attname||':'||format_type(a.atttypid,a.atttypmod)||':'||a.attnotnull::TEXT,',' ORDER BY a.attnum))
      INTO digest FROM pg_attribute a WHERE a.attrelid=object_id AND a.attnum>0 AND NOT a.attisdropped;
    IF digest IS DISTINCT FROM item->>'digest' THEN RETURN FALSE; END IF;
  END LOOP;
  RETURN TRUE;
EXCEPTION WHEN OTHERS THEN RETURN FALSE;
END;
$body$,manifest::TEXT);
  EXECUTE format('CREATE FUNCTION public.yo_finance_cache_coverage() RETURNS BOOLEAN LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS %L',body);
  SELECT md5(pg_get_functiondef('public.yo_finance_cache_coverage()'::regprocedure)) INTO self_hash;
  body=replace(body,'-- self-md5:'||repeat('0',32),'-- self-md5:'||self_hash);
  EXECUTE format('CREATE OR REPLACE FUNCTION public.yo_finance_cache_coverage() RETURNS BOOLEAN LANGUAGE plpgsql STABLE SET search_path = pg_catalog, public AS %L',body);
END;
$install$;
COMMENT ON FUNCTION public.yo_finance_cache_coverage() IS 'finance-snapshot-v1';

COMMIT;
