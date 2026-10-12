import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [schema,migration]=await Promise.all([
  readFile(new URL("../prisma/schema.prisma",import.meta.url),"utf8"),
  readFile(new URL("../prisma/migrations/20261012110000_add_order_sale_types/migration.sql",import.meta.url),"utf8"),
]);

test("типы продаж сайта и склада добавляются расширяющей миграцией",()=>{
  assert.match(schema,/enum OrderType[\s\S]*WEBSITE_SALE[\s\S]*STOCK_SALE/);
  assert.match(migration,/ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'WEBSITE_SALE'/);
  assert.match(migration,/ALTER TYPE "OrderType" ADD VALUE IF NOT EXISTS 'STOCK_SALE'/);
  assert.doesNotMatch(migration,/DROP|DELETE|TRUNCATE/);
});
