import test from "node:test";
import assert from "node:assert/strict";
import { includeRequestedProductionOrder, loadProductionOrders, productionOrderSelect } from "../src/orders/production-context.ts";

test("производство добавляет точный заказ за пределами первых 100", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `order-${index}` }));
  const requested = { id: "order-older-than-100" };
  const result = includeRequestedProductionOrder(firstPage, requested);
  assert.equal(result[0], requested);
  assert.equal(result.length, 101);
});

test("производство не дублирует точный заказ из первой сотни и не возвращает архивный", async () => {
  const visible = [{ id: "order-1" }, { id: "order-2" }];
  assert.deepEqual(includeRequestedProductionOrder(visible, visible[1]), visible);
  assert.deepEqual(includeRequestedProductionOrder(visible, null), visible);
});

test("загрузка производства делает второй ограниченный запрос для точного заказа", async () => {
  const firstPage = [{ id: "order-1" }];
  const exact = { id: "order-101" };
  const calls = [];
  const repository = {
    findMany: async (query) => { calls.push(["many", query]); return firstPage; },
    findFirst: async (query) => { calls.push(["first", query]); return exact; },
  };
  assert.deepEqual((await loadProductionOrders(repository, exact.id, "2026-10-01", "2027-03-31")).map((order) => order.id), [exact.id, ...firstPage.map((order) => order.id)]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].take, 1001);
  assert.equal(calls[0][1].where.OR[0].productionSlot.is.startsAt.lte.toISOString(), "2027-03-31T23:59:59.999Z");
  assert.equal(calls[0][1].where.OR[0].productionSlot.is.endsAt.gte.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.deepEqual(calls[0][1].where.type.notIn, ["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"]);
  assert.deepEqual(calls[1][1].where, { id: exact.id, archivedAt: null, type: { notIn: ["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"] }, salesStatus: { notIn: ["COMPLETED", "CANCELLED"] } });
  assert.equal(calls[1][1].select, productionOrderSelect);
  assert.deepEqual(productionOrderSelect.shipment, { select: { trackingNumber: true } });
  assert.equal(productionOrderSelect.deliveryTrackingCode, true);
  assert.equal(productionOrderSelect.shippingStatus, true);
  for (const forbidden of ["payments", "invoices", "address", "postalCode", "measurement", "activities"]) {
    assert.equal(forbidden in productionOrderSelect, false);
  }
});

test("производство возвращает только признак накладной без самого трек-номера", async () => {
  const repository = {
    findMany: async () => [{ id: "tracked-order", deliveryTrackingCode: "LEGACY-SECRET", shipment: { trackingNumber: "SHIPMENT-SECRET" } }],
    findFirst: async () => null,
  };

  const [order] = await loadProductionOrders(repository, undefined, "2026-10-01", "2026-11-01");

  assert.equal(order.hasTrackingNumber, true);
  assert.equal("deliveryTrackingCode" in order, false);
  assert.equal("shipment" in order, false);
});

test("производство не теряет текущие слоты после импорта более 100 старых заказов", async () => {
  const historical = Array.from({ length: 100 }, (_, index) => ({ id: `historical-${index}`, productionSlot: { startsAt: "2023-01-01", endsAt: "2023-01-07" } }));
  const current = Array.from({ length: 20 }, (_, index) => ({ id: `current-${index}`, productionSlot: { startsAt: "2026-10-01", endsAt: "2026-10-07" } }));
  const all = [...historical, ...current];
  const repository = {
    findMany: async (query) => all.slice(0, query.take),
    findFirst: async () => null,
  };

  const result = await loadProductionOrders(repository, undefined, "2026-10-01", "2026-11-30");

  assert.equal(result.filter((order) => order.id.startsWith("current-")).length, 20);
});

test("производство ограничивает ответ видимым периодом и серверным пределом", async () => {
  const calls = [];
  const repository = { findMany: async (query) => { calls.push(query); return []; }, findFirst: async () => null };
  await loadProductionOrders(repository, undefined, "2026-10-01", "2026-11-05");
  assert.equal(calls[0].take, 1001);
  assert.equal(calls[0].where.OR.length, 3);
  assert.deepEqual(calls[0].where.OR[2], { productionSlot: { is: null }, requiredDeliveryAt: null });
});

test("производство отклоняет некорректный и чрезмерно широкий период", async () => {
  const repository = { findMany: async () => [], findFirst: async () => null };
  await assert.rejects(() => loadProductionOrders(repository, undefined, "2026-11-01", "2026-10-01"), /INVALID_PRODUCTION_RANGE/);
  await assert.rejects(() => loadProductionOrders(repository, undefined, "2026-10-01", "2027-10-03"), /INVALID_PRODUCTION_RANGE/);
  await assert.rejects(() => loadProductionOrders(repository, undefined, "not-a-date", "2026-11-01"), /INVALID_PRODUCTION_RANGE/);
});

test("производство не скрывает молча заказы сверх серверного предела", async () => {
  const repository = {
    findMany: async () => Array.from({ length: 1001 }, (_, index) => ({ id: `order-${index}` })),
    findFirst: async () => null,
  };
  await assert.rejects(() => loadProductionOrders(repository, undefined, "2026-10-01", "2026-11-01"), /PRODUCTION_RESULT_LIMIT_EXCEEDED/);
});

test("завершённый заказ не попадает в первую сотню производства", async () => {
  const calls = [];
  const repository = {
    findMany: async (query) => { calls.push(query); return []; },
    findFirst: async () => null,
  };
  assert.deepEqual(await loadProductionOrders(repository), []);
  assert.deepEqual(calls[0].where.salesStatus.notIn, ["COMPLETED", "CANCELLED"]);
});

test("точный завершённый или отменённый заказ не возвращается в производство", async () => {
  const calls = [];
  const repository = {
    findMany: async () => [],
    findFirst: async (query) => { calls.push(query); return null; },
  };
  assert.deepEqual(await loadProductionOrders(repository, "terminal-order"), []);
  assert.deepEqual(calls[0].where.salesStatus.notIn, ["COMPLETED", "CANCELLED"]);
});

test("быстрая продажа не попадает в производство даже по прямой ссылке", async () => {
  const calls = [];
  const repository = {
    findMany: async (query) => { calls.push(query); return []; },
    findFirst: async (query) => { calls.push(query); return null; },
  };
  assert.deepEqual(await loadProductionOrders(repository, "ready-sale"), []);
  assert.deepEqual(calls[0].where.type.notIn, ["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"]);
  assert.deepEqual(calls[1].where.type.notIn, ["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"]);
});
