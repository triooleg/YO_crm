import {loadTargetModule} from './overview-target-loader.mjs';
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const reconcileOrderItemInstances = async (tx, item, quantity) => {
  const existing = await tx.orderItemInstance.findMany({ where: { orderItemId: item.id } });
  for (let ordinal = 1; ordinal <= quantity; ordinal += 1) {
    if (!existing.some(instance => instance.ordinal === ordinal && !instance.archivedAt)) {
      await tx.orderItemInstance.create({ data: { orderItemId: item.id, ordinal, athleteId: item.athleteId ?? null, measurementId: item.measurementId ?? null, productionStatus: item.productionStatus } });
    }
  }
};

function loadOrdersService() {
  const source = readFileSync(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const localRequire = specifier => {
    if (specifier === "@nestjs/common") return { BadRequestException: class extends Error {}, ConflictException: class extends Error {}, Injectable: () => target => target, NotFoundException: class extends Error {} };
    if (specifier === "../prisma.service") return { PrismaService: class {} };
    if (specifier === "../finance/exchange-rates") return { appliedPaymentMinor: () => 0, buildPaymentConversion: () => ({}), ExchangeRatesService: class {}, EXCHANGE_RATE_ADVISORY_LOCK: "exchange", parseExchangeRateCache: () => ({}) };
    if (specifier === "../communications/inbound-routing") return { presentClientContact: value => value };
    if (specifier === "../keycrm/keycrm-normalizer") return { keycrmSourceChannel: () => "UNKNOWN" };
    if (specifier === "../uploads") return { uploadsRoot: () => "uploads" };
    if (specifier === "./orders.dto") return {};
    if (specifier === "./order-archive") return { archiveOrdersTransaction: async () => ({}), OrderArchiveError: class extends Error {}, ORDER_ARCHIVE_ERROR: {} };
    if (specifier === "./order-delivery-address") return { DELIVERY_ADDRESS_ERROR: {}, DeliveryAddressOperationError: class extends Error {}, persistOrderDeliveryAddress: async () => ({}) };
    if (specifier === "./order-currency") return { changeOrderCurrencyTransaction: async () => ({}), OrderCurrencyChangeError: class extends Error {} };
    if (specifier === "./order-image-name") return { isOrderImageName: () => true };
    if (specifier === "./order-model-image") return { ORDER_MODEL_IMAGE_ERROR: {}, OrderModelImageOperationError: class extends Error {}, persistOrderModelImage: async () => ({}) };
    if (specifier === "./order-details") return { ORDER_DETAILS_ERROR: {}, OrderDetailsOperationError: class extends Error {}, persistOrderDetails: async () => ({}) };
    if (specifier === "./order-item-details") return { ORDER_ITEM_DETAILS_ERROR: {}, OrderItemDetailsError: class extends Error {}, persistAddedOrderItem: async () => ({}), persistOrderItemDetails: async () => ({}), reconcileOrderItemInstances };
    if (specifier === "./order-file-policy") return { buildOrderFileName: () => "file.pdf", decodeOrderFile: () => ({ originalName: "file.pdf", mimeType: "application/pdf", content: Buffer.from("file") }) };
    if (specifier === "./production-rules") return { DEFAULT_PRODUCTION_DURATION_DAYS: 21, DEFAULT_SHIPPING_LEAD_DAYS: 7, productionSetting: value => Number(value), productionWindow: () => ({}), requiresProduction: () => true, resolveProductionSlotTentative: () => true, violatesShippingLead: () => false };
    if (specifier === "./production-status-graph") return { updateProductionStatusGraph: async (tx, orderId, productionStatus, orderData = {}) => tx.order.update({ where: { id: orderId }, data: { ...orderData, productionStatus } }) };
    if (specifier === "./production-context") return { loadProductionOrders: async () => [] };
    if (specifier === "sharp") return () => ({});
    if (specifier === './order-assignment-eligibility' || specifier === './order-source' || specifier === './order-list-read-model') return loadTargetModule('orders/'+specifier.slice(2)+'.ts');
  if (specifier === "../clients/measurement-data") return loadTargetModule("clients/measurement-data.ts");
  return nativeRequire(specifier);
  };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: localRequire, Buffer, console, process, setTimeout, clearTimeout });
  return module.exports.OrdersService;
}

test("manual order creation materializes one active instance per item quantity", async () => {
  const OrdersService = loadOrdersService();
  const items = [
    { id: "item-1", orderId: "order-1", athleteId: "athlete-1", measurementId: "measurement-1", name: "Solo", quantity: 2, priceMinor: 10000, modelImagePath: null, productionStatus: "NOT_SCHEDULED" },
  ];
  const instances = [];
  const tx = {
    $executeRaw: async () => undefined,
    $executeRawUnsafe: async () => undefined,
    appSetting: { findUnique: async () => null },
    client: { findFirst: async () => ({ id: "client-1" }) },
    athlete: { count: async () => 1 },
    measurement: { findMany: async () => [{ id: "measurement-1", athleteId: "athlete-1" }] },
    order: {
      findFirst: async () => null,
      create: async ({ data }) => ({ id: "order-1", number: data.number, type: data.type, requiredDeliveryAt: null, ...data }),
    },
    orderItem: { findMany: async () => structuredClone(items) },
    orderItemInstance: {
      findMany: async ({ where }) => structuredClone(instances.filter(instance => instance.orderItemId === where.orderItemId)),
      create: async ({ data }) => { const row = { id: `instance-${data.ordinal}`, archivedAt: null, ...data }; instances.push(row); return row; },
      updateMany: async ({ where, data }) => { for (const instance of instances) if (instance.orderItemId === where.orderItemId && instance.archivedAt === null) Object.assign(instance, data); },
    },
    activity: { create: async () => undefined },
    auditLog: { create: async () => undefined },
  };
  const service = new OrdersService({ $transaction: callback => callback(tx) }, {});
  await service.create({ clientId: "client-1", athleteId: "athlete-1", measurementId: "measurement-1", type: "CUSTOM_ORDER", description: "Solo", priceMinor: 10000, currency: "EUR", items: [{ athleteId: "athlete-1", measurementId: "measurement-1", name: "Solo", quantity: 2, priceMinor: 10000 }] }, { id: "owner-1" });
  assert.deepEqual(instances.map(instance => [instance.ordinal, instance.athleteId, instance.measurementId]), [[1, "athlete-1", "measurement-1"], [2, "athlete-1", "measurement-1"]]);
});
