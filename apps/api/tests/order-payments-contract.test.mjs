import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const controller=readFileSync(new URL("../src/orders/orders.controller.ts",import.meta.url),"utf8");
const service=readFileSync(new URL("../src/orders/orders.service.ts",import.meta.url),"utf8");
const dto=readFileSync(new URL("../src/orders/orders.dto.ts",import.meta.url),"utf8");

test("к заказу можно добавить проверенную оплату",()=>{
  assert.match(controller,/@Post\(":id\/payments"\)/);
  assert.match(dto,/class AddOrderPaymentDto/);
  assert.match(dto,/@IsPositive\(\)/);
  assert.match(service,/async addPayment/);
  assert.match(service,/PAYMENT_RECEIVED/);
  assert.match(service,/paymentStatus/);
});
