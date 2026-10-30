import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../../../packages/database/prisma/migrations/20260809160000_order_number_format/migration.sql", import.meta.url), "utf8");

test("manual orders use the common lifetime counter and persist the same creation instant", () => {
  assert.match(service, /nextOrderNumber, legacyOrderNumberAlias/);
  assert.match(service, /nextOrderNumber\(tx, createdAt\)/);
  assert.match(service, /data: \{ number, createdAt, clientId:/);
  assert.doesNotMatch(service, /startsWith: `YO-/);
});

test("существующий заказ изменяется адресно без массовой перенумерации", () => {
  assert.match(migration, /WHERE number = 'YO-2026-1945722'/);
  assert.match(migration, /SET number = 'YO-26-0001'/);
  assert.doesNotMatch(migration, /ROW_NUMBER|UPDATE[\s\S]+WHERE orders\.id/);
});
