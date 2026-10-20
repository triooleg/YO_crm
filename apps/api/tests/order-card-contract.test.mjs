import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controller=readFileSync(new URL("../src/orders/orders.controller.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../src/orders/orders.service.ts",import.meta.url),"utf8");
const dto=readFileSync(new URL("../src/orders/orders.dto.ts",import.meta.url),"utf8");

test("карточка заказа получает историю и сохраняет независимые статусы",()=>{
  assert.match(controller,/@Patch\(":id\/statuses"\)/);
  assert.match(controller,/UpdateOrderStatusesDto/);
  assert.match(dto,/class UpdateOrderStatusesDto/);
  assert.match(service,/async updateStatuses/);
  assert.match(service,/activities:\s*\{\s*select/);
  assert.match(service,/ORDER_STATUSES_UPDATED/);
  assert.match(service,/entityType:\s*"Order"/);
  const statusUpdate=service.slice(service.indexOf("async updateStatuses("),service.indexOf("async updateDeadline("));
  assert.match(statusUpdate,/pg_advisory_xact_lock\(hashtext\(\$1\)\)/);
  assert.ok(statusUpdate.indexOf("pg_advisory_xact_lock") < statusUpdate.indexOf("tx.order.findFirst"));
});

test("вид спорта заказа изменяется отдельной проверяемой мутацией",()=>{
  assert.match(controller,/@Patch\(":id\/discipline"\)/);
  assert.match(dto,/class UpdateOrderDisciplineDto/);
  assert.match(dto,/@IsEnum\(Discipline\)/);
  assert.match(service,/async updateDiscipline/);
  assert.match(service,/ORDER_DISCIPLINE_UPDATED/);
  assert.match(service,/entityType: "Order"/);
});
