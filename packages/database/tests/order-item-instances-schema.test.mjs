import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
const migration = await readFile(new URL("../prisma/migrations/20261013120000_order_item_instances/migration.sql", import.meta.url), "utf8");
const instance = schema.match(/model OrderItemInstance \{[\s\S]*?\n\}/)?.[0] ?? "";

test("physical costume instances keep stable item athlete measurement and production links", () => {
  for (const field of ["orderItemId", "ordinal", "athleteId", "measurementId", "productionStatus", "plannedStartAt", "plannedEndAt", "completedAt", "archivedAt"]) {
    assert.match(instance, new RegExp(`\\b${field}\\b`), field);
  }
  assert.match(instance, /@@unique\(\[orderItemId, ordinal\]\)/);
});

test("migration fails closed on anomalous quantities and preserves monetary values", () => {
  assert.match(migration, /"quantity" < 1 OR "quantity" > 100/);
  assert.match(migration, /generate_series\(1, oi\."quantity"\)/);
  assert.match(migration, /ON CONFLICT \("orderItemId", "ordinal"\) DO NOTHING/);
  assert.doesNotMatch(migration, /UPDATE "Order" SET "priceMinor"/);
  assert.doesNotMatch(migration, /UPDATE "OrderItem" SET "priceMinor"/);
  assert.doesNotMatch(migration, /Shipment_orderId_key/);
});
