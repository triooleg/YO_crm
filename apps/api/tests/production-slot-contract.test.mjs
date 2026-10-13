import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const controller=await readFile(new URL("../src/orders/orders.controller.ts",import.meta.url),"utf8");
const service=await readFile(new URL("../src/orders/orders.service.ts",import.meta.url),"utf8");
test("слот сохраняется с аудитом и блокировкой",()=>{assert.match(controller,/production-slot/);assert.match(service,/productionSlot\.upsert/);assert.match(service,/PRODUCTION_SLOT_UPDATED/);assert.match(service,/locked/);assert.match(service,/auditLog\.create/)});

test("изменение слота сериализуется с платежом и не возвращает оплаченный слот в предварительные",()=>{
  const updateSlot=service.slice(service.indexOf("async updateProductionSlot"),service.indexOf("async addPayment"));
  assert.match(updateSlot,/\$transaction\(async tx/);
  assert.match(updateSlot,/pg_advisory_xact_lock/);
  assert.ok(updateSlot.indexOf("pg_advisory_xact_lock")<updateSlot.indexOf("order.findFirst"));
  assert.match(updateSlot,/tx\.order\.findFirst/);
  assert.match(updateSlot,/appliedPaymentMinor\(payment, order\.currency\)/);
  assert.match(updateSlot,/resolveProductionSlotTentative\(paid, order\.depositRequiredMinor, dto\.tentative\)/);
  assert.ok(updateSlot.indexOf("productionSlot.upsert")<updateSlot.indexOf("activity.create"));
  assert.ok(updateSlot.indexOf("activity.create")<updateSlot.indexOf("auditLog.create"));
});

test("order deadline is edited with activity and audit",()=>{assert.match(controller,/deadline/);assert.match(service,/ORDER_DEADLINE_UPDATED/);assert.match(service,/requiredDeliveryAt/);assert.match(service,/auditLog\.create/)});

test("быстрые продажи нельзя вручную или автоматически поставить в производство",()=>{
  const updateStatuses=service.slice(service.indexOf("async updateStatuses"),service.indexOf("async updateDeadline"));
  const updateSlot=service.slice(service.indexOf("async updateProductionSlot"),service.indexOf("async addPayment"));
  const createOrder=service.slice(service.indexOf("async create("));
  assert.match(updateStatuses,/requiresProduction\(order\.type\)/);
  assert.match(updateSlot,/requiresProduction\(order\.type\)/);
  assert.match(createOrder,/order\.requiredDeliveryAt && requiresProduction\(order\.type\)/);
});

test("производственный слот удаляется отдельно от заказа с аудитом",()=>{
  assert.match(controller,/@Delete\(":id\/production-slot"\)/);
  assert.match(controller,/deleteProductionSlot/);
  const deleteSlot=service.slice(service.indexOf("async deleteProductionSlot"),service.indexOf("async addPayment"));
  assert.match(deleteSlot,/\$transaction\(async tx/);
  assert.match(deleteSlot,/productionSlot\.delete/);
  assert.match(deleteSlot,/updateProductionStatusGraph[\s\S]*ProductionStatus\.NOT_SCHEDULED/);
  assert.match(deleteSlot,/PRODUCTION_SLOT_DELETED/);
  assert.match(deleteSlot,/action:\s*"DELETE"/);
  assert.match(deleteSlot,/productionSlot\.updatedAt\.toISOString\(\) !== dto\.expectedUpdatedAt/);
});
