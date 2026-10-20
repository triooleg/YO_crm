import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../prisma/migrations/20261018120000_shipment_customer_charge_currency/migration.sql", import.meta.url), "utf8");
const schema = await readFile(new URL("../prisma/schema.prisma", import.meta.url), "utf8");

test("shipping provenance is exactly three nullable columns without historical rewrites", () => {
  const shipment = schema.match(/model OrderShipment \{([\s\S]*?)\n\}/)[1];
  for (const [name, type] of [["customerChargeOriginalMinor", "Int"], ["customerChargeOriginalCurrency", "String"], ["customerChargeRateSnapshot", "Json"]]) {
    assert.match(shipment, new RegExp(`\\b${name}\\s+${type}\\?`));
    assert.match(migration, new RegExp(`ADD COLUMN "${name}"`));
  }
  const statements = migration.replace(/--[^\n]*/g, "");
  assert.doesNotMatch(statements, /\b(?:UPDATE|DELETE|INSERT|DROP|TRUNCATE|DEFAULT)\b/i);
  assert.doesNotMatch(statements, /ADD COLUMN[^,;]*\bNOT NULL\b/i);
  assert.equal((statements.match(/ADD COLUMN/g) ?? []).length, 3);
});

test("shipping currency migration preserves historical rows and rejects partial provenance", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE "OrderShipment" ("id" TEXT PRIMARY KEY, "customerChargeMinor" INTEGER NOT NULL, "currency" TEXT NOT NULL, "atelierCostMinor" INTEGER NOT NULL);
      INSERT INTO "OrderShipment" VALUES ('historical', 1500, 'EUR', 800);
    `);
    await db.exec(migration);
    assert.deepEqual((await db.query('SELECT * FROM "OrderShipment"')).rows, [{ id: "historical", customerChargeMinor: 1500, currency: "EUR", atelierCostMinor: 800, customerChargeOriginalMinor: null, customerChargeOriginalCurrency: null, customerChargeRateSnapshot: null }]);
    const insert = `INSERT INTO "OrderShipment" ("id", "customerChargeMinor", "currency", "atelierCostMinor", "customerChargeOriginalMinor", "customerChargeOriginalCurrency", "customerChargeRateSnapshot") VALUES ($1, 501, 'EUR', 800, $2, $3, $4::jsonb)`;
    await db.query(insert, ["converted", 1001, "USD", JSON.stringify({ from: "USD", to: "EUR", rate: { numerator: "1", denominator: "2" } })]);
    for (const [index, original, currency, snapshot] of [
      [1, 1001, null, null], [2, null, "USD", null], [3, null, null, "{}"],
      [4, 1001, "USD", null], [5, -1, "USD", "{}"], [6, 0, "USD", "{}"],
      [7, 1001, "EUR", "{}"], [8, 1001, "GBP", "{}"], [9, 1001, "USD", "null"], [10, 1001, "USD", "[]"],
    ]) await assert.rejects(() => db.query(insert, [`invalid-${index}`, original, currency, snapshot]), /provenance_check/);
    await assert.rejects(() => db.query(insert, ["overflow", 2147483648, "USD", "{}"]), /range/);
    await db.exec(`INSERT INTO "OrderShipment" ("id", "customerChargeMinor", "currency", "atelierCostMinor") VALUES ('zero', 0, 'EUR', 0)`);
    assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM "OrderShipment"')).rows[0].n, 3);
  } finally { await db.close(); }
});
