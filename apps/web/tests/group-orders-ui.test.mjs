import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../components/order-panel.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("форма создаёт парный и групповой состав", () => {
  assert.match(panel, /orderFormUi\.types\.PAIR/);
  assert.match(panel, /orderFormUi\.types\.GROUP_ORDER/);
  assert.match(panel, /Выберите состав группы/);
  assert.match(i18n, /PAIR:\s*"Парный заказ"/);
  assert.match(i18n, /GROUP_ORDER:\s*"Групповой заказ"/);
  assert.match(panel, /items,/);
});

test("общий список показывает сводную строку варианта A", () => {
  for (const name of ["OrderImages", "orderComposition", "orderMeasurements", "OrderTypeBadge"]) {
    assert.match(list, new RegExp(name));
  }
});

test("раскрытие группового заказа показывает состав по спортсменам", () => {
  assert.match(list, /GroupOrderItems/);
  assert.match(list, /orders-group-items/);
  assert.match(list, /item\.measurement/);
  assert.match(list, /item\.productionStatus/);
});
test("каждая позиция группового заказа показывает свои грудь талию и бёдра", () => {
  assert.match(list, /GroupMeasurementSizes/);
  assert.match(list, /values\?\.m1/);
  assert.match(list, /values\?\.m2/);
  assert.match(list, /values\?\.m3/);
  for (const label of ["Грудь", "Талия", "Бёдра"]) assert.match(i18n, new RegExp(label));
  assert.match(list, /ordersUi\.measurementChest/);
});
