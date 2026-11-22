BEGIN;

CREATE TABLE "OrderStatusOption" (
  "id" TEXT PRIMARY KEY,
  "baseStatus" "SalesStatus" NOT NULL,
  "label" TEXT,
  "color" TEXT CHECK ("color" ~ '^#[0-9A-Fa-f]{6}$'),
  "archivedAt" TIMESTAMP(3)
);

ALTER TABLE "Order" ADD COLUMN "salesStatusOptionId" TEXT;
ALTER TABLE "Order" ADD CONSTRAINT "Order_salesStatusOptionId_fkey"
  FOREIGN KEY ("salesStatusOptionId") REFERENCES "OrderStatusOption"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION clear_custom_order_status_on_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."salesStatus" IS DISTINCT FROM OLD."salesStatus"
     AND NEW."salesStatusOptionId" IS NOT DISTINCT FROM OLD."salesStatusOptionId" THEN
    NEW."salesStatusOptionId" := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER clear_custom_order_status_on_transition
BEFORE UPDATE OF "salesStatus" ON "Order"
FOR EACH ROW EXECUTE FUNCTION clear_custom_order_status_on_transition();

COMMIT;
