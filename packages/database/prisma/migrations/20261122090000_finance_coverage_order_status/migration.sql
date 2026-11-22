BEGIN;

-- The order-status migration added one nullable field that is not a finance
-- input. Accept precisely that layout change; retain all other coverage checks.
LOCK TABLE public."Order" IN ACCESS SHARE MODE;

DO $migration$
DECLARE
  definition TEXT := pg_get_functiondef('public.yo_finance_cache_coverage()'::regprocedure);
  previous_seal TEXT := substring(definition FROM '-- self-md5:([0-9a-f]{32})');
  zero_seal TEXT := '-- self-md5:' || repeat('0',32);
  unsealed_definition TEXT;
  manifest JSONB;
  previous_digest TEXT;
  installed_digest TEXT;
  order_entry JSONB;
BEGIN
  IF previous_seal IS NULL
    OR obj_description('public.yo_finance_cache_coverage()'::regprocedure,'pg_proc') IS DISTINCT FROM 'finance-snapshot-v1'
    OR md5(replace(definition,'-- self-md5:'||previous_seal,zero_seal)) IS DISTINCT FROM previous_seal
  THEN RAISE EXCEPTION 'Unexpected finance coverage function'; END IF;

  manifest := substring(definition FROM $regexp$DECLARE expected JSONB := '(.*?)'::JSONB$regexp$)::JSONB;
  SELECT value INTO STRICT order_entry
  FROM jsonb_array_elements(manifest->'tables') WHERE value->>'name'='Order';

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid='public."Order"'::regclass AND attname='salesStatusOptionId'
      AND attnum>0 AND NOT attisdropped AND atttypid='text'::regtype AND NOT attnotnull
  ) THEN RAISE EXCEPTION 'Expected nullable Order.salesStatusOptionId text column'; END IF;

  SELECT
    md5(string_agg(signature,',' ORDER BY attnum) FILTER (WHERE attname<>'salesStatusOptionId')),
    md5(string_agg(signature,',' ORDER BY attnum))
  INTO previous_digest,installed_digest
  FROM (
    SELECT attnum,attname,attname||':'||format_type(atttypid,atttypmod)||':'||attnotnull::TEXT AS signature
    FROM pg_attribute WHERE attrelid='public."Order"'::regclass AND attnum>0 AND NOT attisdropped
  ) columns;

  IF previous_digest IS NULL OR previous_digest IS DISTINCT FROM order_entry->>'digest'
    OR installed_digest IS NULL OR installed_digest=previous_digest
  THEN RAISE EXCEPTION 'Unexpected Order schema drift'; END IF;

  -- Only the one Order digest inside the sealed manifest may change.
  IF length(definition)-length(replace(definition,previous_digest,''))<>length(previous_digest)
  THEN RAISE EXCEPTION 'Ambiguous Order digest in finance coverage function'; END IF;

  unsealed_definition := replace(replace(definition,previous_digest,installed_digest),
    '-- self-md5:'||previous_seal,zero_seal);
  EXECUTE unsealed_definition;
  EXECUTE replace(unsealed_definition,zero_seal,'-- self-md5:' ||
    md5(pg_get_functiondef('public.yo_finance_cache_coverage()'::regprocedure)));

  IF public.yo_finance_cache_coverage() IS DISTINCT FROM TRUE
  THEN RAISE EXCEPTION 'Finance coverage is still incomplete'; END IF;

  -- Every snapshot family depends on epoch. Rebuild from authoritative facts
  -- so no projection written before the schema change can become trusted again.
  PERFORM public.yo_finance_cache_bump(ARRAY['epoch']);
END;
$migration$;

COMMIT;
