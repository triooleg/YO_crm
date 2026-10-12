import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { defaultOrderSort, nextOrderSort, SORTABLE_ORDER_COLUMNS, sortOrders } from "../lib/order-sort.mjs";

const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/orders-dashboard.css", import.meta.url), "utf8");

const orders = [
  { id: "b", number: "KC-2", createdAt: "2026-10-02T00:00:00Z", requiredDeliveryAt: "2026-11-02T00:00:00Z", priceMinor: 20000, depositRequiredMinor: 10000, discipline: "FIGURE_SKATING", salesStatus: "NEW_LEAD", productionStatus: "SCHEDULED", shippingStatus: "NOT_READY", client: { displayName: "Yana", country: "Ukraine" }, items: [{ name: "Blue", quantity: 1 }], payments: [] },
  { id: "a", number: "KC-1", createdAt: "2026-10-01T00:00:00Z", requiredDeliveryAt: "2026-10-20T00:00:00Z", priceMinor: 30000, depositRequiredMinor: 15000, discipline: "RHYTHMIC_GYMNASTICS", salesStatus: "PAID", productionStatus: "READY", shippingStatus: "READY", client: { displayName: "Anna", country: "France" }, items: [{ name: "Amber", quantity: 3 }], payments: [{ amountMinor: 10000 }] },
];

test("повторный клик по заголовку меняет направление сортировки", () => {
  assert.deepEqual(nextOrderSort({ column: "client", direction: "asc" }, "client"), { column: "client", direction: "desc" });
  assert.deepEqual(nextOrderSort({ column: "client", direction: "desc" }, "quantity"), { column: "quantity", direction: "desc" });
});

test("helper поддерживает утверждённые колонки и сохраняет legacy sort ids", () => {
  for (const column of ["model", "production", "discipline", "designs", "nextAction"])
    assert.ok(SORTABLE_ORDER_COLUMNS.includes(column), `missing sort id: ${column}`);

  assert.deepEqual(defaultOrderSort("model"), { column: "model", direction: "asc" });
  assert.deepEqual(defaultOrderSort("production"), { column: "production", direction: "asc" });
});

test("новые объединённые колонки сортируются по модели со спортом и производственному слоту", () => {
  const laterModel = {
    ...orders[0],
    id: "later-model",
    number: "KC-20",
    discipline: "RHYTHMIC_GYMNASTICS",
    items: [{ name: "Zebra", quantity: 1 }],
    productionSlot: { startsAt: "2026-11-10T00:00:00Z" },
  };
  const earlierModel = {
    ...orders[1],
    id: "earlier-model",
    number: "KC-21",
    discipline: "FIGURE_SKATING",
    items: [{ name: "Amber", quantity: 1 }],
    productionSlot: { startsAt: "2026-11-01T00:00:00Z" },
  };

  assert.deepEqual(sortOrders([laterModel, earlierModel], { column: "model", direction: "asc" }).map((order) => order.id), ["earlier-model", "later-model"]);
  assert.deepEqual(sortOrders([laterModel, earlierModel], { column: "production", direction: "asc" }).map((order) => order.id), ["earlier-model", "later-model"]);
});

test("таблица сортирует данные по выбранной колонке в обоих направлениях", () => {
  assert.deepEqual(sortOrders(orders, { column: "client", direction: "asc" }).map((order) => order.id), ["a", "b"]);
  assert.deepEqual(sortOrders(orders, { column: "client", direction: "desc" }).map((order) => order.id), ["b", "a"]);
  assert.deepEqual(sortOrders(orders, { column: "quantity", direction: "desc" }).map((order) => order.id), ["a", "b"]);
  assert.deepEqual(sortOrders(orders, { column: "deadline", direction: "asc" }).map((order) => order.id), ["a", "b"]);
});

test("сортировка оплаты не смешивает валюты без подтверждённого пересчёта", () => {
  const foreign = { ...orders[0], id: "foreign", number: "KC-3", currency: "EUR", priceMinor: 30000, payments: [{ amountMinor: 30000, currency: "USD" }] };
  const converted = { ...orders[0], id: "converted", number: "KC-4", currency: "EUR", priceMinor: 30000, payments: [{ amountMinor: 30000, currency: "USD", appliedAmountMinor: 20000, appliedCurrency: "EUR" }] };
  const wrongTarget = { ...orders[0], id: "wrong-target", number: "KC-5", currency: "EUR", priceMinor: 30000, payments: [{ amountMinor: 30000, currency: "USD", appliedAmountMinor: 25000, appliedCurrency: "UAH" }] };

  assert.deepEqual(sortOrders([converted, foreign, wrongTarget], { column: "payment", direction: "desc" }).map((order) => order.id), ["foreign", "wrong-target", "converted"]);
});

test("переплаченные заказы сортируются по тому же нулевому остатку, который показан в таблице", () => {
  const paidExactly = { ...orders[0], id: "paid-exactly", number: "KC-10", currency: "EUR", priceMinor: 30000, payments: [{ amountMinor: 30000, currency: "EUR" }] };
  const overpaid = { ...orders[0], id: "overpaid", number: "KC-11", currency: "EUR", priceMinor: 30000, payments: [{ amountMinor: 35000, currency: "EUR" }] };

  assert.deepEqual(sortOrders([overpaid, paidExactly], { column: "payment", direction: "asc" }).map((order) => order.id), ["paid-exactly", "overpaid"]);
});

test("вычисляемая колонка сортируется по тому же отображаемому значению", () => {
  const projection = (order, column) => column === "nextAction" ? { a: "Получить замеры", b: "Заказ готов" }[order.id] : undefined;
  assert.deepEqual(sortOrders(orders, { column: "nextAction", direction: "asc" }, projection).map((order) => order.id), ["b", "a"]);
});

test("заголовки таблицы доступны как кнопки сортировки и показывают направление", () => {
  assert.match(dashboard, /aria-sort=\{sort\.column === id/);
  assert.match(dashboard, /className="orders-sort-heading"/);
  assert.match(dashboard, /nextOrderSort\(current, id\)/);
  assert.match(styles, /\.orders-sort-heading\{/);
});
