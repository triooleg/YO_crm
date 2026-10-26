import {loadTargetModule} from './overview-target-loader.mjs';
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const controllerSource = readFileSync(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
class BadRequestException extends Error {}
class ConflictException extends Error {}
class NotFoundException extends Error {}
const common = { BadRequestException, ConflictException, Injectable: () => target => target, NotFoundException };
const reconcileOrderItemInstances = async (tx, item, quantity) => {
  const existing = await tx.orderItemInstance.findMany({ where: { orderItemId: item.id } });
  for (let ordinal = 1; ordinal <= quantity; ordinal += 1) {
    if (!existing.some(instance => instance.ordinal === ordinal && !instance.archivedAt)) {
      await tx.orderItemInstance.create({ data: { orderItemId: item.id, ordinal, athleteId: item.athleteId ?? null, measurementId: item.measurementId ?? null, productionStatus: item.productionStatus } });
    }
  }
};
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
const ordersModule = { exports: {} };
const orderRequire = specifier => {
  if (specifier === "@nestjs/common") return common;
  if (specifier === "../finance/invoice-number") return loadTargetModule("finance/invoice-number.ts");
  if (specifier === "../clients/measurement-data") return loadTargetModule("clients/measurement-data.ts");
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
  if (specifier === "./order-design-number") return { ORDER_DESIGN_NUMBER_ERROR: {}, OrderDesignNumberError: class extends Error {}, persistOrderDesignNumber: async () => ({}) };
  if (specifier === "./order-file-policy") return { buildOrderFileName: () => "file.pdf", decodeOrderFile: () => ({ originalName: "file.pdf", mimeType: "application/pdf", content: Buffer.from("file") }) };
  if (specifier === "./production-rules") return { DEFAULT_PRODUCTION_DURATION_DAYS: 21, DEFAULT_SHIPPING_LEAD_DAYS: 7, productionSetting: value => Number(value), productionWindow: () => ({}), requiresProduction: () => true, resolveProductionSlotTentative: () => true, violatesShippingLead: () => false };
  if (specifier === "./production-status-graph") return { updateProductionStatusGraph: async (tx, orderId, productionStatus, orderData = {}) => tx.order.update({ where: { id: orderId }, data: { ...orderData, productionStatus } }) };
  if (specifier === "./production-context") return { loadProductionOrders: async () => [] };
  if (specifier === "sharp") return () => ({});
  if (specifier === './order-assignment-eligibility' || specifier === './order-source' || specifier === './order-list-read-model' || specifier === './website-order-fee') return loadTargetModule('orders/'+specifier.slice(2)+'.ts');
  return nativeRequire(specifier);
};
vm.runInNewContext(compile("../src/orders/orders.service.ts"), { module: ordersModule, exports: ordersModule.exports, require: orderRequire, Buffer, console, process, setTimeout, clearTimeout });
const { OrdersService } = ordersModule.exports;

test("item measurement endpoint preserves the existing measurement-write RBAC", () => {
  assert.match(controllerSource, /@Post\(":orderId\/items\/:itemId\/measurement"\)\s+@Roles\(UserRole\.OWNER, UserRole\.ADMIN, UserRole\.MANAGER, UserRole\.PRODUCTION\)/);
  assert.match(controllerSource, /addItemMeasurement\(orderId, itemId, dto, req\.user\)/);
});

const dto = { measuredAt: "2026-10-12T12:00:00.000Z", standardHeight: 159, m1: 80, m2: 65.5, m3: 85, m15: 141, notes: "Новый снимок", expectedMeasurementId: "measurement-old" };

function fixture({ order = {}, athlete = {}, failAudit = false } = {}) {
  const base = {
    id: "order-1", number: "YO-26-0001", clientId: "client-1", archivedAt: null,
    athleteId: "athlete-other", measurementId: "measurement-other",
    items: [
      { id: "item-1", orderId: "order-1", athleteId: "athlete-1", measurementId: "measurement-old", productionStatus: "NOT_SCHEDULED", quantity: 2 },
      { id: "item-2", orderId: "order-1", athleteId: "athlete-other", measurementId: "measurement-other", productionStatus: "NOT_SCHEDULED", quantity: 1 },
    ],
    ...order,
  };
  const state = {
    order: structuredClone(base), measurements: [], activities: [], audits: [], locks: [],
    instances: [
      { id: "instance-1", orderItemId: "item-1", ordinal: 1, athleteId: "athlete-1", measurementId: "measurement-old", productionStatus: "NOT_SCHEDULED", archivedAt: null },
      { id: "instance-2", orderItemId: "item-1", ordinal: 2, athleteId: "athlete-1", measurementId: "measurement-old", productionStatus: "NOT_SCHEDULED", archivedAt: null },
    ],
  };
  const transaction = async callback => {
    const draft = structuredClone(state);
    const tx = {
      $executeRawUnsafe: async (_sql, key) => { draft.locks.push(key); },
      order: {
        findFirst: async () => structuredClone(draft.order),
        update: async ({ data }) => { draft.order = { ...draft.order, ...data }; return structuredClone(draft.order); },
      },
      athlete: { findFirst: async ({ where }) => where.id === "athlete-1" && where.clientId === "client-1" && athlete.exists !== false ? { id: "athlete-1", firstName: "Anna" } : null },
      measurement: { findFirst: async ({where}) => where.id === "measurement-old" && where.athleteId === "athlete-1" ? {id:"measurement-old",athleteId:"athlete-1",definitionVersion:null} : null, create: async ({ data }) => { const value = { id: "measurement-new", ...data }; draft.measurements.push(value); return value; } },
      orderItem: { update: async ({ where, data }) => { const index = draft.order.items.findIndex(item => item.id === where.id); draft.order.items[index] = { ...draft.order.items[index], ...data }; return structuredClone(draft.order.items[index]); } },
      orderItemInstance: {
        findMany: async ({ where }) => structuredClone(draft.instances.filter(instance => instance.orderItemId === where.orderItemId)),
        create: async ({ data }) => { const row = { id: `instance-${draft.instances.length + 1}`, archivedAt: null, ...data }; draft.instances.push(row); return structuredClone(row); },
        updateMany: async ({ where, data }) => { for (const instance of draft.instances) if (instance.orderItemId === where.orderItemId && instance.archivedAt === null) Object.assign(instance, data); },
      },
      activity: { create: async ({ data }) => { draft.activities.push(data); } },
      auditLog: { create: async ({ data }) => { if (failAudit) throw new Error("audit unavailable"); draft.audits.push(data); } },
    };
    const result = await callback(tx);
    Object.assign(state, draft);
    return result;
  };
  return { state, service: new OrdersService({ $transaction: transaction }, {}) };
}

test("item-specific measurement creates an immutable snapshot and updates only the target item", async () => {
  const target = fixture();
  const result = await target.service.addItemMeasurement("order-1", "item-1", dto, { id: "owner-1" });
  assert.equal(result.id, "measurement-new");
  assert.deepEqual(target.state.locks, ["order-1"]);
  assert.equal(target.state.measurements.length, 1);
  assert.equal(target.state.order.items[0].measurementId, "measurement-new");
  assert.equal(target.state.order.items[1].measurementId, "measurement-other");
  assert.deepEqual(target.state.instances.map(instance => instance.measurementId), ["measurement-new", "measurement-new"]);
  assert.equal(target.state.order.measurementId, "measurement-other");
  assert.equal(target.state.activities[0].metadata.itemId, "item-1");
  assert.deepEqual(target.state.audits.map(entry => entry.entityType), ["Measurement", "OrderItem"]);
});

test("single-item order measurement propagates the immutable snapshot to every active instance", async () => {
  const target = fixture({ order: { athleteId: "athlete-1", measurementId: "measurement-old", items: [{ id: "item-1", orderId: "order-1", athleteId: "athlete-1", measurementId: "measurement-old", productionStatus: "NOT_SCHEDULED", quantity: 2 }] } });
  await target.service.addMeasurement("order-1", dto, { id: "owner-1" });
  assert.equal(target.state.order.measurementId, "measurement-new");
  assert.equal(target.state.order.items[0].measurementId, "measurement-new");
  assert.deepEqual(target.state.instances.map(instance => instance.measurementId), ["measurement-new", "measurement-new"]);
});

test("matching legacy top-level references mirror the target item measurement", async () => {
  const target = fixture({ order: { athleteId: "athlete-1", measurementId: "measurement-old" } });
  await target.service.addItemMeasurement("order-1", "item-1", dto, { id: "owner-1" });
  assert.equal(target.state.order.measurementId, "measurement-new");
  assert.deepEqual(target.state.audits.map(entry => entry.entityType), ["Measurement", "OrderItem", "Order"]);
});

test("single-item legacy order without top-level references is mirrored safely", async () => {
  const target = fixture({ order: { athleteId: null, measurementId: null, items: [{ id: "item-1", orderId: "order-1", athleteId: "athlete-1", measurementId: "measurement-old" }] } });
  await target.service.addItemMeasurement("order-1", "item-1", dto, { id: "owner-1" });
  assert.equal(target.state.order.athleteId, "athlete-1");
  assert.equal(target.state.order.measurementId, "measurement-new");
});

test("ambiguous multi-item legacy references are not mirrored to the order", async () => {
  const target = fixture({ order: { athleteId: "athlete-1", measurementId: null } });
  await target.service.addItemMeasurement("order-1", "item-1", dto, { id: "owner-1" });
  assert.equal(target.state.order.measurementId, null);
  assert.deepEqual(target.state.audits.map(entry => entry.entityType), ["Measurement", "OrderItem"]);
});

test("stale expected measurement blocks the write before snapshot creation", async () => {
  const target = fixture();
  await assert.rejects(() => target.service.addItemMeasurement("order-1", "item-1", { ...dto, expectedMeasurementId: "stale" }, { id: "owner-1" }), ConflictException);
  assert.equal(target.state.measurements.length, 0);
});

test("foreign item and foreign athlete ownership fail closed", async () => {
  const wrongItem = fixture();
  await assert.rejects(() => wrongItem.service.addItemMeasurement("order-1", "item-foreign", dto, { id: "owner-1" }), NotFoundException);
  assert.equal(wrongItem.state.measurements.length, 0);
  const wrongAthlete = fixture({ athlete: { exists: false } });
  await assert.rejects(() => wrongAthlete.service.addItemMeasurement("order-1", "item-1", dto, { id: "owner-1" }), NotFoundException);
  assert.equal(wrongAthlete.state.measurements.length, 0);
});

test("measurements outside the 0.5 cm step are rejected before the transaction", async () => {
  const target = fixture();
  await assert.rejects(() => target.service.addItemMeasurement("order-1", "item-1", { ...dto, m2: 65.25 }, { id: "owner-1" }), error => /шагом 0,5 см/.test(error.message));
  assert.deepEqual(target.state.locks, []);
});

test("audit failure rolls back snapshot, item, activity, and legacy mirror", async () => {
  const target = fixture({ order: { athleteId: "athlete-1", measurementId: "measurement-old" }, failAudit: true });
  await assert.rejects(() => target.service.addItemMeasurement("order-1", "item-1", dto, { id: "owner-1" }));
  assert.equal(target.state.measurements.length, 0);
  assert.equal(target.state.order.items[0].measurementId, "measurement-old");
  assert.equal(target.state.order.measurementId, "measurement-old");
  assert.equal(target.state.activities.length, 0);
});

function bindingFixture({ foreignMeasurement = false } = {}) {
  const state = {
    items: [
      { id: "item-1", orderId: "order-1", athleteId: "athlete-1", measurementId: "measurement-old", productionStatus: "NOT_SCHEDULED", quantity: 2, order: { clientId: "client-1", number: "YO-26-0001" } },
      { id: "item-2", orderId: "order-1", athleteId: "athlete-2", measurementId: "measurement-other", productionStatus: "NOT_SCHEDULED", quantity: 1, order: { clientId: "client-1", number: "YO-26-0001" } },
    ],
    instances: [
      { id: "instance-1", orderItemId: "item-1", ordinal: 1, athleteId: "athlete-1", measurementId: "measurement-old", productionStatus: "NOT_SCHEDULED", archivedAt: null },
      { id: "instance-2", orderItemId: "item-1", ordinal: 2, athleteId: "athlete-1", measurementId: "measurement-old", productionStatus: "NOT_SCHEDULED", archivedAt: null },
    ],
    activities: [], audits: [], locks: [],
  };
  const prisma = {
    $transaction: async callback => {
      const draft = structuredClone(state);
      const tx = {
        $executeRawUnsafe: async (_sql, key) => draft.locks.push(key),
        order: { findFirst: async () => ({clientId:"client-1",salesStatus:"NEW_LEAD",shippingStatus:"NOT_READY",orderShipments:[]}) },
        orderItem: {
          findFirst: async ({ where }) => structuredClone(draft.items.find(item => item.id === where.id && item.orderId === where.orderId) ?? null),
          update: async ({ where, data }) => { const index = draft.items.findIndex(item => item.id === where.id); draft.items[index] = { ...draft.items[index], ...data }; return structuredClone(draft.items[index]); },
        },
        orderItemInstance: {
          findMany: async ({ where }) => structuredClone(draft.instances.filter(instance => instance.orderItemId === where.orderItemId)),
          create: async ({ data }) => { const row = { id: `instance-${draft.instances.length + 1}`, archivedAt: null, ...data }; draft.instances.push(row); return structuredClone(row); },
          updateMany: async ({ where, data }) => { for (const instance of draft.instances) if (instance.orderItemId === where.orderItemId && instance.archivedAt === null && (where.athleteId === undefined || instance.athleteId === where.athleteId) && (where.measurementId === undefined || instance.measurementId === where.measurementId)) Object.assign(instance, data); },
        },
        measurement: { findFirst: async ({ where }) => where.id === "measurement-new" && !foreignMeasurement ? { id: "measurement-new", athleteId: "athlete-1" } : null },
        activity: { create: async ({ data }) => draft.activities.push(data) },
        auditLog: { create: async ({ data }) => draft.audits.push(data) },
      };
      const result = await callback(tx);
      Object.assign(state, draft);
      return result;
    },
  };
  return { state, service: new OrdersService(prisma, {}) };
}

test("binding an immutable snapshot changes only the selected order item and survives a reload", async () => {
  const target = bindingFixture();
  const result = await target.service.bindItemMeasurement("order-1", "item-1", { measurementId: "measurement-new", expectedMeasurementId: "measurement-old" }, { id: "owner-1" });
  assert.equal(result.measurementId, "measurement-new");
  assert.equal(target.state.items[0].measurementId, "measurement-new");
  assert.equal(target.state.items[1].measurementId, "measurement-other");
  assert.deepEqual(target.state.instances.map(instance => instance.measurementId), ["measurement-new", "measurement-new"]);
  assert.deepEqual(target.state.locks, ["order-1"]);
  assert.equal(target.state.activities[0].type, "ORDER_ITEM_MEASUREMENT_BOUND");
  assert.equal(JSON.stringify(target.state.audits[0].before), JSON.stringify({ athleteId: "athlete-1", measurementId: "measurement-old" }));
  assert.equal(JSON.stringify(target.state.audits[0].after), JSON.stringify({ athleteId: "athlete-1", measurementId: "measurement-new" }));
  assert.equal(target.state.items.find(item => item.id === "item-1").measurementId, "measurement-new");
});

test("item-level measurement binding preserves an individually assigned sibling instance", async () => {
  const target = bindingFixture();
  target.state.instances[1].athleteId = "athlete-2";
  target.state.instances[1].measurementId = "measurement-individual";
  await target.service.bindItemMeasurement("order-1", "item-1", { measurementId: "measurement-new", expectedMeasurementId: "measurement-old" }, { id: "owner-1" });
  assert.deepEqual(target.state.instances.map(instance => [instance.athleteId, instance.measurementId]), [
    ["athlete-1", "measurement-new"],
    ["athlete-2", "measurement-individual"],
  ]);
});

test("stale or foreign measurement binding is rejected without mutations", async () => {
  const stale = bindingFixture();
  await assert.rejects(() => stale.service.bindItemMeasurement("order-1", "item-1", { measurementId: "measurement-new", expectedMeasurementId: "stale" }, { id: "owner-1" }), ConflictException);
  assert.equal(stale.state.items[0].measurementId, "measurement-old");
  assert.deepEqual(stale.state.activities, []);
  const foreign = bindingFixture({ foreignMeasurement: true });
  await assert.rejects(() => foreign.service.bindItemMeasurement("order-1", "item-1", { measurementId: "measurement-new", expectedMeasurementId: "measurement-old" }, { id: "owner-1" }), BadRequestException);
  assert.equal(foreign.state.items[0].measurementId, "measurement-old");
  assert.deepEqual(foreign.state.activities, []);
});
