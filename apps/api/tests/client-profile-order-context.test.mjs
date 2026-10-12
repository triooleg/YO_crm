import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controller=readFileSync(new URL("../src/clients/clients.controller.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../src/clients/clients.service.ts",import.meta.url),"utf8");
const orders=readFileSync(new URL("../src/orders/orders.service.ts",import.meta.url),"utf8");

test("редактирование клиента защищено ролями, optimistic lock и аудитом",()=>{
  assert.match(controller,/@Patch\(":id"\)[\s\S]*updateProfile/);
  assert.match(service,/before\.updatedAt\.toISOString\(\)!==dto\.expectedUpdatedAt/);
  assert.match(service,/client-merge-global/);
  assert.match(service,/client-merge:"\+id/);
  assert.match(service,/updatedAt:before\.updatedAt/);
  assert.match(service,/changed\.count!==1/);
  assert.match(service,/type:"CLIENT_PROFILE_UPDATED"/);
  assert.match(service,/entityType:"Client"/);
  assert.match(service,/dto\.email===undefined\?before\.email/);
});

test("проекция заказа содержит версию карточки клиента",()=>{
  assert.match(orders,/client:[\s\S]*updatedAt: true/);
});
