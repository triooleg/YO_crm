-- Unify historical business order numbers under the YO prefix without touching
-- order identity, timestamps, relations, payments, taxes, production or delivery.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '120s';
LOCK TABLE "Order" IN SHARE ROW EXCLUSIVE MODE;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Order"
    WHERE "number" ~* '^KC-[1-9][0-9]*$'
    GROUP BY lower('YO-' || substring("number" from 4))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'duplicate legacy order number projection';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "Order" legacy
    JOIN "Order" target
      ON lower(target."number") = lower('YO-' || substring(legacy."number" from 4))
     AND target.id <> legacy.id
    WHERE legacy."number" ~* '^KC-[1-9][0-9]*$'
  ) THEN
    RAISE EXCEPTION 'YO order number collision';
  END IF;
END
$$;

INSERT INTO "AuditLog" (
  id, action, "entityType", "entityId", before, after, "requestId", "createdAt"
)
SELECT
  'ordernum_' || md5(legacy.id || ':KC_TO_YO'),
  'ORDER_NUMBER_PREFIX_MIGRATED',
  'Order',
  legacy.id,
  jsonb_build_object('number', legacy.number, 'externalNumber', legacy."externalNumber"),
  jsonb_build_object(
    'number', 'YO-' || substring(legacy.number from 4),
    'externalNumber', CASE
      WHEN legacy."externalNumber" ~* '^KC-[1-9][0-9]*$'
        THEN 'YO-' || substring(legacy."externalNumber" from 4)
      ELSE legacy."externalNumber"
    END
  ),
  'migration:20261023170000_unify_order_number_prefix',
  now()
FROM "Order" legacy
WHERE legacy.number ~* '^KC-[1-9][0-9]*$';

UPDATE "Order"
SET
  "number" = 'YO-' || substring("number" from 4),
  "externalNumber" = CASE
    WHEN "externalNumber" ~* '^KC-[1-9][0-9]*$'
      THEN 'YO-' || substring("externalNumber" from 4)
    ELSE "externalNumber"
  END
WHERE "number" ~* '^KC-[1-9][0-9]*$';

COMMIT;
