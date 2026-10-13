import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controller=readFileSync(new URL("../src/orders/orders.controller.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../src/orders/orders.service.ts",import.meta.url),"utf8");
const dto=readFileSync(new URL("../src/orders/orders.dto.ts",import.meta.url),"utf8");
const schema=readFileSync(new URL("../../../packages/database/prisma/schema.prisma",import.meta.url),"utf8");

test("к заказу можно добавить проверенную оплату",()=>{
  assert.match(controller,/@Post\(":id\/payments"\)/);
  assert.match(dto,/class AddOrderPaymentDto/);
  assert.match(dto,/@IsPositive\(\)/);
  assert.match(service,/async addPayment/);
  assert.match(service,/PAYMENT_RECEIVED/);
  assert.match(service,/paymentStatus/);
});

test("достижение порога предоплаты атомарно подтверждает предварительный слот",()=>{
  const addPayment=service.slice(service.indexOf("async addPayment"),service.indexOf("async addMeasurement"));
  const transactionBody=addPayment.slice(addPayment.indexOf("return this.prisma.$transaction"));
  assert.match(addPayment,/\$transaction\(async \(tx\)/);
  assert.match(addPayment,/pg_advisory_xact_lock/);
  assert.ok(transactionBody.indexOf("pg_advisory_xact_lock")<transactionBody.indexOf("order.findFirst"));
  assert.match(addPayment,/include:\s*\{\s*payments:\s*\{\s*where:\s*\{\s*voidedAt:\s*null\s*\}\s*\},\s*productionSlot:\s*true\s*\}/);
  assert.match(addPayment,/appliedPaymentMinor\(payment, order\.currency\)/);
  assert.match(addPayment,/totalPaid >= order\.depositRequiredMinor/);
  assert.match(addPayment,/order\.productionSlot\?\.tentative/);
  assert.match(addPayment,/productionSlot\.update/);
  assert.match(addPayment,/tentative:\s*false/);
  assert.match(addPayment,/updateProductionStatusGraph[\s\S]*ProductionStatus\.SCHEDULED/);
  assert.match(addPayment,/PRODUCTION_SLOT_CONFIRMED/);
  assert.match(addPayment,/depositRequiredMinor:\s*order\.depositRequiredMinor,\s*currency:\s*order\.currency,\s*paymentCurrency:\s*currency/);
  assert.match(addPayment,/entityType:\s*"ProductionSlot"/);
});

test("оплата в другой валюте автоматически получает официальный снимок пересчёта",()=>{
  const addPayment=service.slice(service.indexOf("async addPayment"),service.indexOf("async addMeasurement"));
  assert.match(addPayment,/currentOrRefresh\(actor\)/);
  assert.match(addPayment,/buildPaymentConversion/);
  assert.doesNotMatch(addPayment,/Оплата должна быть в валюте заказа/);
  assert.match(schema,/appliedAmountMinor\s+Int\?/);
  assert.match(schema,/appliedCurrency\s+String\?/);
  assert.match(schema,/exchangeRateSnapshot\s+Json\?/);
});
