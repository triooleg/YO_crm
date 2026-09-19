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
  assert.deepEqual(await loadProductionOrders(repository, exact.id), [exact, ...firstPage]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0][1].where, { archivedAt: null, salesStatus: { notIn: ["COMPLETED", "CANCELLED"] } });
  assert.deepEqual(calls[1][1].where, { id: exact.id, archivedAt: null, salesStatus: { notIn: ["COMPLETED", "CANCELLED"] } });
  assert.equal(calls[1][1].select, productionOrderSelect);
  for (const forbidden of ["payments", "invoices", "shipment", "address", "postalCode", "measurement", "activities"]) {
    assert.equal(forbidden in productionOrderSelect, false);
  }
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
