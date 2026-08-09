import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const dto=readFileSync(new URL("../src/orders/orders.dto.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../src/orders/orders.service.ts",import.meta.url),"utf8");
test("групповой заказ принимает и сохраняет позиции",()=>{
  assert.match(dto,/class CreateOrderItemDto/);
  assert.match(dto,/items\?: CreateOrderItemDto\[\]/);
  assert.match(service,/items: \{ create:/);
  assert.match(service,/athleteIds/);
});
