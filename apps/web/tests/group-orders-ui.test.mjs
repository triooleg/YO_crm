import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../components/order-panel.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");

test("форма создаёт парный и групповой состав", () => {
  for (const text of ["Парный заказ", "Групповой заказ", "Выберите состав группы"]) {
    assert.match(panel, new RegExp(text));
  }
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
