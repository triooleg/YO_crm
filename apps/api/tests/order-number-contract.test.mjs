import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../../../packages/database/prisma/migrations/20260809160000_order_number_format/migration.sql", import.meta.url), "utf8");

test("номер заказа имеет формат YO-26-0001 и последовательность внутри года", () => {
  assert.match(service, /const year = String\(now\.getFullYear\(\)\)\.slice\(-2\)/);
  assert.match(service, /startsWith: `YO-\$\{year\}-`/);
  assert.match(service, /padStart\(4, "0"\)/);
  assert.doesNotMatch(service, /Date\.now\(\)\.toString/);
});
test("существующий заказ изменяется адресно без массовой перенумерации", () => {
  assert.match(migration, /WHERE number = 'YO-2026-1945722'/);
  assert.match(migration, /SET number = 'YO-26-0001'/);
  assert.doesNotMatch(migration, /ROW_NUMBER|UPDATE[\s\S]+WHERE orders\.id/);
});
