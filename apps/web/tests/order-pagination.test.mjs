import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { ORDER_PAGE_SIZES, paginateOrders, parseOrderPaginationState } from "../lib/order-pagination.ts";

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
  const listMethod = service.slice(service.indexOf("async list("), service.indexOf("async detail("));
  assert.doesNotMatch(listMethod, /take:\s*100/);
  assert.match(dashboard, /paginateOrders\(sorted, page, pageSize\)/);
});

test("состояние страницы безопасно восстанавливается в пределах разрешённых размеров", () => {
  assert.deepEqual(ORDER_PAGE_SIZES, [20, 30, 50, 70, 100]);
  assert.deepEqual(parseOrderPaginationState('{"page":3,"pageSize":50}'), { page: 3, pageSize: 50 });
  assert.deepEqual(parseOrderPaginationState('{"page":2,"pageSize":100}'), { page: 2, pageSize: 100 });
});

test("повреждённое состояние пагинации не ломает список", () => {
  for (const raw of [null, "", "{", '{"page":0,"pageSize":50}', '{"page":1.5,"pageSize":20}', '{"page":2,"pageSize":25}']) {
    assert.deepEqual(parseOrderPaginationState(raw), { page: 1, pageSize: 20 });
  }
});

test("30 and 70 restore and paginate all real records without gaps",()=>{const items=Array.from({length:137},(_,id)=>({id}));for(const size of [30,70]){assert.deepEqual(parseOrderPaginationState(JSON.stringify({page:2,pageSize:size})),{page:2,pageSize:size});const seen=[];for(let page=1;page<=Math.ceil(items.length/size);page++)seen.push(...paginateOrders(items,page,size).items.map(item=>item.id));assert.deepEqual(seen,items.map(item=>item.id));assert.equal(new Set(seen).size,137);}});
