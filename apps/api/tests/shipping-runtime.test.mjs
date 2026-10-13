import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { aggregateShippingStatus } from "../src/shipping/shipping-status.ts";
import { calculateShippingFinance, shippingCustomerCharge } from "../src/shipping/shipping-finance.ts";

const nativeRequire = createRequire(import.meta.url);
function loadShippingService() {
  const source = readFileSync(new URL("../src/shipping/shipping.service.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  const localRequire = specifier => {
    if (specifier === "../prisma.service") return { PrismaService: class PrismaService {} };
    if (specifier === "../finance/exchange-rates") return { appliedPaymentMinor: payment => payment.amountMinor };
    if (specifier === "./shipping.dto") return {};
    if (specifier === "./shipping-status") return { aggregateShippingStatus };
    if (specifier === "./shipping-finance") return { calculateShippingFinance, shippingCustomerCharge };
    if (specifier === "../orders/production-rules") return { requiresProduction: type => !["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"].includes(type) };
    if (specifier === "../orders/production-status-graph") return { updateProductionStatusGraph: async (tx, orderId, productionStatus, orderData, options) => {
      const updated = await tx.order.update({ where: { id: orderId }, data: { ...orderData, productionStatus } });
      await tx.orderItem.updateMany({ where: { orderId }, data: { productionStatus } });
      await tx.orderItemInstance.updateMany({ where: options?.preserveProgress ? { orderItem: { orderId }, archivedAt: null, productionStatus: { in: ["NOT_SCHEDULED", "TENTATIVE", "SCHEDULED"] } } : { orderItem: { orderId }, archivedAt: null }, data: { productionStatus } });
      return updated;
    } };
    return nativeRequire(specifier);
  };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: localRequire, console, process, Date });
  return module.exports.ShippingService;
}

test("legacy delivery endpoint with two parcels fails before any mutation", async () => {
  let writes = 0;
  const tx = {
    $executeRawUnsafe: async () => 1,
    order: { findFirst: async () => ({ id: "order-1", currency: "EUR", shipment: { updatedAt: new Date("2026-10-13T10:00:00Z") }, orderShipments: [{ id: "s1" }, { id: "s2" }] }) },
    shipment: { upsert: async () => { writes += 1; } },
    orderShipment: { update: async () => { writes += 1; }, create: async () => { writes += 1; } },
  };
  const ShippingService = loadShippingService();
  const service = new ShippingService({ $transaction: callback => callback(tx) });
  await assert.rejects(() => service.upsert("order-1", {}, { id: "owner-1" }), /несколько посылок/);
  assert.equal(writes, 0);
});

test("two parcels update order price, delivery, deposit and payment once from their aggregate", async () => {
  const writes = [];
  const tx = {
    orderShipment: { findMany: async () => [
      { id: "s1", status: "SHIPPED", customerChargeMinor: 1200, currency: "EUR" },
      { id: "s2", status: "READY", customerChargeMinor: 800, currency: "EUR" },
    ] },
    order: {
      findUniqueOrThrow: async () => ({ id: "order-1", currency: "EUR", priceMinor: 11000, deliveryMinor: 1000, depositRequiredMinor: 5500, paymentStatus: "PARTIALLY_PAID", payments: [{ amountMinor: 6000 }], productionSlot: null }),
      update: async ({ data }) => { writes.push(data); return data; },
    },
    shipment: { upsert: async () => ({}) },
    productionSlot: { update: async () => ({}) },
    auditLog: { create: async () => ({}) },
  };
  const ShippingService = loadShippingService();
  const service = new ShippingService({});
  await service.refreshOrderShipping(tx, "order-1", "owner-1");
  assert.equal(writes.length, 1);
  assert.equal(JSON.stringify(writes[0]), JSON.stringify({ deliveryMinor: 2000, shippingStatus: "SHIPPED", priceMinor: 12000, depositRequiredMinor: 6000, paymentStatus: "DEPOSIT_PAID" }));
});

test("shipment expense cannot create or reactivate a finance category through manager shipping access", async () => {
  let expenseWrites = 0;
  const tx = {
    expense: {
      findUnique: async () => null,
      create: async () => { expenseWrites += 1; return {}; },
    },
    expenseCategory: { findFirst: async () => null },
    auditLog: { create: async () => ({}) },
  };
  const ShippingService = loadShippingService();
  const service = new ShippingService({});
  await assert.rejects(
    () => service.persistAtelierExpense(tx, "order-1", null, 1800, "EUR", null, "manager-1"),
    /финансовую категорию «Доставка»/,
  );
  assert.equal(expenseWrites, 0);
});

test("delivery recalculation confirms a tentative slot through the audited production graph", async () => {
  const writes = [];
  const tx = {
    orderShipment: { findMany: async () => [{ id: "s1", status: "READY", customerChargeMinor: 1000, currency: "EUR" }] },
    order: {
      findUniqueOrThrow: async () => ({ id: "order-1", clientId: "client-1", type: "INDIVIDUAL", productionStatus: "NOT_SCHEDULED", currency: "EUR", priceMinor: 12000, deliveryMinor: 2000, depositRequiredMinor: 6000, paymentStatus: "PARTIALLY_PAID", payments: [{ amountMinor: 5500 }], productionSlot: { id: "slot-1", tentative: true } }),
      update: async ({ data }) => { writes.push(["order", data]); return { id: "order-1", ...data }; },
    },
    orderItem: { updateMany: async args => { writes.push(["items", args]); return { count: 1 }; } },
    orderItemInstance: { updateMany: async args => { writes.push(["instances", args]); return { count: 1 }; } },
    productionSlot: { update: async ({ data }) => { writes.push(["slot", data]); return { id: "slot-1", ...data }; } },
    shipment: { upsert: async () => ({}) },
    activity: { create: async ({ data }) => { writes.push(["activity", data.type]); return {}; } },
    auditLog: { create: async ({ data }) => { writes.push(["audit", data.entityType]); return {}; } },
  };
  const ShippingService = loadShippingService();
  const service = new ShippingService({});
  await service.refreshOrderShipping(tx, "order-1", "manager-1");
  assert.equal(writes.some(([kind, data]) => kind === "order" && data.productionStatus === "SCHEDULED"), true);
  assert.equal(writes.some(([kind]) => kind === "instances"), true);
  assert.equal(writes.some(([kind, value]) => kind === "activity" && value === "PRODUCTION_SLOT_CONFIRMED"), true);
  assert.equal(writes.some(([kind, value]) => kind === "audit" && value === "ProductionSlot"), true);
});
