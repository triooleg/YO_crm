import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const clients = await readFile(new URL("../components/client-workspace.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const source = await readFile(new URL("../lib/order-source.ts", import.meta.url), "utf8");

test("общий список показывает только порядковую часть номера заказа", () => {
  assert.match(workspace, /orderListNumber\(o\.number\)/);
  assert.match(workspace, /function orderListNumber/);
});

test("карточка клиента показывает номер KeyCRM и сохраняет технический в подсказке", () => {
  assert.match(clients, /<strong title=\{o\.number\}>\{orderDisplayNumber\(o\)\}<\/strong>/);
});

test("заказ сайта предпочитает последовательный номер CRM и сохраняет поддержку старых номеров", () => {
  assert.match(source, /order\.sourceSystem==='YOLEOTARD_WEBSITE'/);
  assert.match(source, /order\.externalNumber/);
  assert.match(dashboard, /orderDisplayNumber\(order\)/);
  assert.match(dashboard, /title=\{order\.number\}/);
  assert.match(source, /WEB-\$\{order\.externalId\}/);
  assert.match(source, /websiteItemName/);
  assert.match(source, /\(\?:YO\|WEB\)-\[1-9\]\\d\*\$/);
});
