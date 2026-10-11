import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(new URL("../prisma/migrations/20261011200000_payment_currency_conversion/migration.sql", import.meta.url), "utf8");

test("миграция валютных платежей сохраняет старые строки с nullable-полями", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      CREATE TABLE "Payment" ("id" TEXT PRIMARY KEY, "amountMinor" INTEGER NOT NULL, "currency" TEXT NOT NULL);
      INSERT INTO "Payment" ("id", "amountMinor", "currency") VALUES ('payment-existing', 10000, 'EUR');
    `);
    await db.exec(migration);
    const result = await db.query(`SELECT "id", "amountMinor", "currency", "appliedAmountMinor", "appliedCurrency", "exchangeRateSnapshot" FROM "Payment"`);
    assert.deepEqual(result.rows, [{ id: "payment-existing", amountMinor: 10000, currency: "EUR", appliedAmountMinor: null, appliedCurrency: null, exchangeRateSnapshot: null }]);
  } finally {
    await db.close();
  }
});
