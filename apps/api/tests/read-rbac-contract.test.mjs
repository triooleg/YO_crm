import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const clientsController = await readFile(
  new URL("../src/clients/clients.controller.ts", import.meta.url),
  "utf8",
);
const ordersController = await readFile(
  new URL("../src/orders/orders.controller.ts", import.meta.url),
  "utf8",
);
const productionContext = await readFile(
  new URL("../src/orders/production-context.ts", import.meta.url),
  "utf8",
);
const ordersService = await readFile(
  new URL("../src/orders/orders.service.ts", import.meta.url),
  "utf8",
);

const crmReadRoles = "@Roles(UserRole.OWNER, UserRole.ADMIN, UserRole.MANAGER)";

test("broad client reads are limited to CRM roles", () => {
  assert.match(
    clientsController,
    new RegExp(`@Get\\(\\)\\s+${escapeRegExp(crmReadRoles)}\\s+list\\(`),
  );
  assert.match(
    clientsController,
    new RegExp(`@Get\\(\":id\"\\)\\s+${escapeRegExp(crmReadRoles)}\\s+detail\\(`),
  );
});

test("broad order reads are limited to CRM roles", () => {
  assert.match(
    ordersController,
    new RegExp(`@Get\\(\\)\\s+${escapeRegExp(crmReadRoles)}\\s+list\\(`),
  );
});

test("production reads use a dedicated least-privilege projection", () => {
  assert.match(
    ordersController,
    /@Get\("production"\)\s+@Roles\(UserRole\.OWNER, UserRole\.ADMIN, UserRole\.MANAGER, UserRole\.PRODUCTION\)\s+productionList\(/,
  );

  const projection = productionContext.slice(
    productionContext.indexOf("export const productionOrderSelect"),
    productionContext.indexOf("export function includeRequestedProductionOrder"),
  );
  const productionMethod = ordersService.slice(
    ordersService.indexOf("async productionList("),
    ordersService.indexOf("async updateStatuses("),
  );
  assert.match(projection, /productionSlot: true/);
  assert.match(projection, /deliveryTrackingCode: true/);
  assert.match(projection, /shippingStatus: true/);
  assert.match(projection, /shipment: \{ select: \{ trackingNumber: true, shippedAt: true, deliveredAt: true \} \}/);
  assert.match(projection, /payments: \{[\s\S]*where: \{ voidedAt: null \}/);
  assert.match(projection, /client: \{ select: \{ displayName: true, country: true \} \}/);
  assert.doesNotMatch(projection, /invoices|address|postalCode|language|source|measurement|activities|carrier|costMinor/);
  assert.match(productionContext, /const \{ deliveryTrackingCode, payments, shipment, \.\.\.safeOrder \} = order/);
  assert.match(productionContext, /latestPaymentAt/);
  assert.match(productionContext, /hasTrackingNumber: Boolean\(shipment\?\.trackingNumber\?\.trim\(\) \|\| deliveryTrackingCode\?\.trim\(\)\)/);
  assert.match(productionMethod, /loadProductionOrders\(this\.prisma\.order(?: as unknown as ProductionOrderRepository)?, orderId, from, to, new Date\(\), overview\)/);
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
