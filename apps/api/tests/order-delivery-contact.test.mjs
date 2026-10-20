import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const controller = readFileSync(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const dto = readFileSync(new URL("../src/orders/orders.dto.ts", import.meta.url), "utf8");
const service = readFileSync(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../../web/components/orders-dashboard.tsx", import.meta.url), "utf8");

test("контакты доставки редактируются отдельным защищённым маршрутом", () => {
  assert.match(controller, /@Patch\(":id\/delivery-contact"\)\s+@Roles\("OWNER", "ADMIN", "MANAGER"\)/);
  assert.match(controller, /updateDeliveryContact\(@Param\("id"\) id: string/);
  assert.match(dto, /class UpdateOrderDeliveryContactDto/);
  assert.match(service, /async updateDeliveryContact\(/);
  assert.match(service, /deliveryEmail: email/);
  assert.doesNotMatch(service.slice(service.indexOf("async updateDeliveryContact"),service.indexOf("async uploadOrderFile")),/tx\.client\.update/);
});

test("вкладка доставки открывает редактор телефона и e-mail без перезагрузки", () => {
  assert.match(dashboard, /DeliveryContactModal/);
  assert.match(dashboard, /onDeliveryContact/);
  assert.match(dashboard, /\/orders\/\$\{order\.id\}\/delivery-contact/);
  assert.match(dashboard, /expectedRecipientPhone/);
  assert.match(dashboard, /expectedEmail/);
});
