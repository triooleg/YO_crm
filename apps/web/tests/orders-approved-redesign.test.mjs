import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const css = await readFile(new URL("../app/orders-dashboard.css", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("утверждённая таблица объединяет модель и спорт и сохраняет отдельные доменные колонки", () => {
  assert.match(dashboard, /const DEFAULT_COLUMNS: ColumnId\[\] = \["client", "model", "quantity", "deadline", "payment", "production", "delivery", "status", "created", "menu"\]/);
  assert.match(i18n, /model:\s*"Модель \/ Спорт"/);
  assert.match(i18n, /production:\s*"Производство"/);
  assert.doesNotMatch(dashboard, /orders-client-cell[\s\S]{0,500}<OrderDesigns/);
  assert.match(dashboard, /orders-model-sport-cell/);
});

test("раскрытый заказ использует обзорную панель и девять рабочих вкладок", () => {
  for (const token of [
    "orders-order-overview",
    "orders-order-identity",
    "orders-order-flow",
    "orders-order-deadlines",
    "orders-order-actions",
    "orders-order-tabs",
    "orders-order-tab-panel",
  ]) assert.match(dashboard, new RegExp(token));
  for (const key of ["details", "designs", "measurements", "client", "finance", "production", "delivery", "notes", "history"])
    assert.match(dashboard, new RegExp(`key: "${key}"`));
  assert.match(css, /\.orders-order-overview/);
  assert.match(css, /\.orders-order-tabs/);
});

test("смена статуса обновляет локальное состояние без повторной загрузки списка", () => {
  const source = dashboard.match(/async function changeStatus\([\s\S]*?\r?\n  }\r?\n  async function changeDeadline/)?.[0] ?? "";
  assert.match(source, /await request\(`\/orders\/\$\{order\.id\}\/statuses`/);
  assert.doesNotMatch(source, /await load\(\)/);
  assert.match(source, /await refreshOrder\(order\.id\)/);
  assert.match(source, /setOrders/);
  assert.match(source, /previous/);
});

test("срок готовности не подменяет плановую отправку, а инвойс сохраняет собственную валюту", () => {
  assert.match(dashboard, /label=\{ui\.plannedShipping\} value=\{ui\.notSpecifiedFeminine\}/);
  assert.doesNotMatch(dashboard, /label=\{ui\.plannedShipping\} value=\{deliveryDate\(order\)\}/);
  assert.match(dashboard, /money\(invoice\.totalMinor, invoice\.currency \|\| order\.currency\)/);
});

test("активная Mantine-вкладка получает утверждённое визуальное состояние", () => {
  assert.match(css, /\.orders-order-tabs button\[data-active\]/);
});
