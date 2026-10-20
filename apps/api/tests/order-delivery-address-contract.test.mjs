import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schema = await readFile(new URL("../../../packages/database/prisma/schema.prisma", import.meta.url), "utf8");
const dto = await readFile(new URL("../src/orders/orders.dto.ts", import.meta.url), "utf8");
const controller = await readFile(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const delivery = await readFile(new URL("../src/orders/order-delivery-address.ts", import.meta.url), "utf8");

test("заказ хранит собственный снимок адреса доставки", () => {
  for (const field of ["deliveryAddressSet", "deliveryRecipient", "deliveryAddressLine1", "deliveryAddressLine2", "deliveryCity", "deliveryRegion", "deliveryPostalCode", "deliveryAddressText"]) assert.match(schema, new RegExp(`\\b${field}\\s+`));
});

test("адрес заказа изменяется отдельной защищенной мутацией", () => {
  const method = service.slice(service.indexOf("async updateDeliveryAddress"), service.indexOf("async updateProductionSlot"));
  assert.match(dto, /class UpdateOrderDeliveryAddressDto/);
  assert.match(controller, /@UseGuards\(SessionGuard, RolesGuard\)/);
  assert.match(controller, /@Patch\(":id\/delivery-address"\) @Roles\(\.\.\.ORDER_DELIVERY_ADDRESS_ROLES\)/);
  assert.match(delivery, /ORDER_DELIVERY_ADDRESS_ROLES = \["OWNER", "ADMIN", "MANAGER"\]/);
  assert.match(method, /\$transaction\(tx => persistOrderDeliveryAddress/);
  assert.match(method, /NotFoundException\(\{ code: error\.code \}\)/);
  assert.match(delivery, /pg_advisory_xact_lock/);
  assert.ok(delivery.indexOf("pg_advisory_xact_lock") < delivery.indexOf("tx.order.findFirst"));
  assert.match(delivery, /archivedAt:\s*null/);
  assert.match(delivery, /resolveExistingDeliveryAddress/);
  assert.match(delivery, /resolveDeliveryAddress/);
  assert.match(delivery, /ORDER_DELIVERY_ADDRESS_UPDATED/);
  assert.match(delivery, /entityType:\s*"Order"/);
  assert.match(delivery, /await tx\.activity\.create/);
  assert.match(delivery, /await tx\.auditLog\.create/);
  assert.doesNotMatch(delivery, /tx\.(client|athlete|measurement|payment|productionSlot)\.update/);
  assert.doesNotMatch(delivery, /(salesStatus|productionStatus|paymentStatus|shippingStatus):/);
});

test("список заказов возвращает снимок адреса для интерфейса", () => {
  for (const field of ["deliveryAddressSet", "deliveryRecipient", "deliveryAddressLine1", "deliveryAddressLine2", "deliveryCity", "deliveryRegion", "deliveryPostalCode", "deliveryAddressText"]) assert.match(service, new RegExp(`${field}: true`));
});
