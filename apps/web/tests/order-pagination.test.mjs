import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { paginateOrders } from "../lib/order-pagination.ts";

const service = readFileSync(new URL("../../api/src/orders/orders.service.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");

test("все 101 заказ доступны через локальную пагинацию", () => {
  const orders = Array.from({ length: 101 }, (_, index) => ({ id: index + 1 }));
  const lastPage = paginateOrders(orders, 6, 20);
  assert.equal(lastPage.totalPages, 6);
  assert.deepEqual(lastPage.items.map((order) => order.id), [101]);
  assert.equal(lastPage.page, 6);
});

test("API не обрезает список заказов до ста записей", () => {
  const listMethod = service.slice(service.indexOf("async list("), service.indexOf("async productionList("));
  assert.doesNotMatch(listMethod, /take:\s*100/);
  assert.match(dashboard, /paginateOrders\(sorted, page, PAGE_SIZE\)/);
});
