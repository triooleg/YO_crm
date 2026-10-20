import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import {loadTargetModule} from './overview-target-loader.mjs';

const nativeRequire = createRequire(import.meta.url);
const source = readFileSync(new URL("../src/orders/production-context.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
const localRequire = (specifier) => specifier === "../finance/exchange-rates"
  ? { appliedPaymentMinor: (payment, orderCurrency) => payment.currency === orderCurrency ? payment.amountMinor : payment.appliedCurrency === orderCurrency && Number.isSafeInteger(payment.appliedAmountMinor) && (payment.appliedAmountMinor ?? -1) >= 0 ? payment.appliedAmountMinor : 0 }
  : specifier==='./order-shipping-evidence'?loadTargetModule('orders/order-shipping-evidence.ts'):nativeRequire(specifier);
vm.runInNewContext(javascript, { module, exports: module.exports, require: localRequire, console, Date });
const { includeRequestedProductionOrder, loadProductionOrders, productionOrderSelect } = module.exports;
const plain = (value) => JSON.parse(JSON.stringify(value));

test("производство добавляет точный заказ за пределами первых 100", async () => {
  const firstPage = Array.from({ length: 100 }, (_, index) => ({ id: `order-${index}` }));
  const requested = { id: "order-older-than-100" };
  const result = includeRequestedProductionOrder(firstPage, requested);
  assert.equal(result[0], requested);
  assert.equal(result.length, 101);
});

test("производство не дублирует точный заказ из первой сотни и не возвращает архивный", async () => {
  const visible = [{ id: "order-1" }, { id: "order-2" }];
  assert.deepEqual(plain(includeRequestedProductionOrder(visible, visible[1])), visible);
  assert.deepEqual(plain(includeRequestedProductionOrder(visible, null)), visible);
});

test("загрузка производства делает второй ограниченный запрос для точного заказа", async () => {
  const firstPage = [{ id: "order-1" }];
  const exact = { id: "order-101" };
  const calls = [];
  const repository = {
    findMany: async (query) => { calls.push(["many", query]); return firstPage; },
    findFirst: async (query) => { calls.push(["first", query]); return exact; },
  };
  assert.deepEqual(plain((await loadProductionOrders(repository, exact.id, "2026-10-01", "2027-03-31")).map((order) => order.id)), [exact.id, ...firstPage.map((order) => order.id)]);
  assert.equal(calls.length, 2);
  assert.equal(calls[0][1].take, 1001);
  assert.equal(calls[0][1].where.OR[0].productionSlot.is.startsAt.lte.toISOString(), "2027-03-31T23:59:59.999Z");
  assert.equal(calls[0][1].where.OR[0].productionSlot.is.endsAt.gte.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.deepEqual(plain(calls[0][1].where.type.notIn), ["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"]);
  assert.deepEqual(plain(calls[1][1].where), { AND: [{OR:[{items:{some:{archivedAt:null}}},{AND:[{compositionOperations:{none:{}}},{items:{none:{archivedAt:{not:null}}}}]}]}], id: exact.id, archivedAt: null, type: { notIn: ["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"] }, salesStatus: { notIn: ["COMPLETED", "CANCELLED"] } });
  assert.equal(calls[1][1].select, productionOrderSelect);
  assert.deepEqual(plain(productionOrderSelect.shipment), { select: { trackingNumber: true, shippedAt: true, deliveredAt: true } });
  assert.equal(productionOrderSelect.deliveryTrackingCode, true);
  assert.equal(productionOrderSelect.shippingStatus, true);
  assert.equal(productionOrderSelect.salesStatus, true);
  assert.equal(productionOrderSelect.depositRequiredMinor, true);
  assert.equal(productionOrderSelect.paymentStatus, true);
  assert.deepEqual(plain(productionOrderSelect.payments.where), { voidedAt: null });
  for (const forbidden of ["invoices", "address", "postalCode", "measurement", "activities"]) {
    assert.equal(forbidden in productionOrderSelect, false);
  }
});

test("производственная проекция считает только применённые действительные оплаты и не раскрывает их строки", async () => {
  const repository = {
    findMany: async () => [
      {
        id: "unpaid",
        currency: "EUR",
        priceMinor: 30000,
        depositRequiredMinor: 15000,
        paymentStatus: "REFUNDED",
        payments: [],
        deliveryTrackingCode: null,
        shipment: null,
      },
      {
        id: "partial-converted",
        currency: "EUR",
        priceMinor: 30000,
        depositRequiredMinor: 15000,
        paymentStatus: "PARTIALLY_PAID",
        payments: [
          { amountMinor: 10000, currency: "USD", appliedAmountMinor: 9000, appliedCurrency: "EUR", receivedAt: new Date("2026-10-03T12:00:00.000Z") },
          { amountMinor: 10000, currency: "UAH", appliedAmountMinor: null, appliedCurrency: null, receivedAt: new Date("2026-10-07T12:00:00.000Z") },
        ],
        deliveryTrackingCode: null,
        shipment: null,
      },
      {
        id: "deposit",
        currency: "EUR",
        priceMinor: 30000,
        depositRequiredMinor: 15000,
        paymentStatus: "DEPOSIT_PAID",
        payments: [{ amountMinor: 15000, currency: "EUR", appliedAmountMinor: null, appliedCurrency: null, receivedAt: new Date("2026-10-04T12:00:00.000Z") }],
        deliveryTrackingCode: null,
        shipment: null,
      },
      {
        id: "paid",
        currency: "EUR",
        priceMinor: 30000,
        depositRequiredMinor: 15000,
        paymentStatus: "PAID",
        payments: [
          { amountMinor: 10000, currency: "EUR", appliedAmountMinor: null, appliedCurrency: null, receivedAt: new Date("2026-10-02T12:00:00.000Z") },
          { amountMinor: 20000, currency: "EUR", appliedAmountMinor: null, appliedCurrency: null, receivedAt: new Date("2026-10-05T12:00:00.000Z") },
        ],
        deliveryTrackingCode: null,
        shipment: { trackingNumber: "TRACK", shippedAt: new Date("2026-10-06T12:00:00.000Z"), deliveredAt: new Date("2026-10-09T12:00:00.000Z") },
      },
    ],
    findFirst: async () => null,
  };

  const orders = await loadProductionOrders(repository, undefined, "2026-10-01", "2026-11-01");

  assert.deepEqual(orders.map((order) => ({
    id: order.id,
    paidMinor: order.paidMinor,
    latestPaymentAt: order.latestPaymentAt?.toISOString() ?? null,
    shippedAt: order.shippedAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
  })), [
    { id: "unpaid", paidMinor: 0, latestPaymentAt: null, shippedAt: null, deliveredAt: null },
    { id: "partial-converted", paidMinor: 9000, latestPaymentAt: "2026-10-03T12:00:00.000Z", shippedAt: null, deliveredAt: null },
    { id: "deposit", paidMinor: 15000, latestPaymentAt: "2026-10-04T12:00:00.000Z", shippedAt: null, deliveredAt: null },
    { id: "paid", paidMinor: 30000, latestPaymentAt: "2026-10-05T12:00:00.000Z", shippedAt: "2026-10-06T12:00:00.000Z", deliveredAt: "2026-10-09T12:00:00.000Z" },
  ]);
  assert.deepEqual(orders.map(order=>order.paymentSettlementKnown), [true,false,true,true]);
  for (const order of orders) {
    assert.equal("payments" in order, false);
    assert.equal("shipment" in order, false);
    assert.equal("deliveryTrackingCode" in order, false);
  }
});

test("производство возвращает только признак накладной без самого трек-номера", async () => {
  const repository = {
    findMany: async () => [
      { id: "shipment-tracked-order", deliveryTrackingCode: null, shipment: { trackingNumber: "SHIPMENT-SECRET" } },
      { id: "legacy-tracked-order", deliveryTrackingCode: "LEGACY-SECRET", shipment: null },
      { id: "untracked-order", deliveryTrackingCode: "  ", shipment: { trackingNumber: "" } },
    ],
    findFirst: async () => null,
  };

  const orders = await loadProductionOrders(repository, undefined, "2026-10-01", "2026-11-01");

  assert.deepEqual(orders.map((order) => [order.id, order.hasTrackingNumber]), [
    ["shipment-tracked-order", true],
    ["legacy-tracked-order", true],
    ["untracked-order", false],
  ]);
  for (const order of orders) {
    assert.equal("deliveryTrackingCode" in order, false);
    assert.equal("shipment" in order, false);
  }
});

test("частично доставленные новые посылки не наследуют доставку из legacy projection", async () => {
  const repository = {
    findMany: async () => [{
      id: "partial-delivery",
      deliveryTrackingCode: null,
      payments: [],
      currency: "EUR",
      shipment: { trackingNumber: "LEGACY", shippedAt: new Date("2026-10-02T00:00:00Z"), deliveredAt: new Date("2026-10-05T00:00:00Z") },
      orderShipments: [
        { trackingNumber: "ONE", shippedAt: new Date("2026-10-02T00:00:00Z"), deliveredAt: new Date("2026-10-05T00:00:00Z") },
        { trackingNumber: "TWO", shippedAt: null, deliveredAt: null },
      ],
    }],
    findFirst: async () => null,
  };
  const [order] = await loadProductionOrders(repository, undefined, "2026-10-01", "2026-11-01");
  assert.equal(order.shippedAt?.toISOString(), "2026-10-02T00:00:00.000Z");
  assert.equal(order.deliveredAt, null);
});

test("производство не теряет текущие слоты после импорта более 100 старых заказов", async () => {
  const historical = Array.from({ length: 100 }, (_, index) => ({ id: `historical-${index}`, productionSlot: { startsAt: "2023-01-01", endsAt: "2023-01-07" } }));
  const current = Array.from({ length: 20 }, (_, index) => ({ id: `current-${index}`, productionSlot: { startsAt: "2026-10-01", endsAt: "2026-10-07" } }));
  const all = [...historical, ...current];
  const repository = {
    findMany: async (query) => all.slice(0, query.take),
    findFirst: async () => null,
  };

  const result = await loadProductionOrders(repository, undefined, "2026-10-01", "2026-11-30");

  assert.equal(result.filter((order) => order.id.startsWith("current-")).length, 20);
});

test("производство ограничивает ответ видимым периодом и серверным пределом", async () => {
  const calls = [];
  const repository = { findMany: async (query) => { calls.push(query); return []; }, findFirst: async () => null };
  await loadProductionOrders(repository, undefined, "2026-10-01", "2026-11-05");
  assert.equal(calls[0].take, 1001);
  assert.equal(calls[0].where.OR.length, 3);
  assert.deepEqual(plain(calls[0].where.OR[2]), { productionSlot: { is: null }, requiredDeliveryAt: null });
});

test("производство отклоняет некорректный и чрезмерно широкий период", async () => {
  const repository = { findMany: async () => [], findFirst: async () => null };
  await assert.rejects(() => loadProductionOrders(repository, undefined, "2026-11-01", "2026-10-01"), /INVALID_PRODUCTION_RANGE/);
  await assert.rejects(() => loadProductionOrders(repository, undefined, "2026-10-01", "2027-10-03"), /INVALID_PRODUCTION_RANGE/);
  await assert.rejects(() => loadProductionOrders(repository, undefined, "not-a-date", "2026-11-01"), /INVALID_PRODUCTION_RANGE/);
});

test("производство не скрывает молча заказы сверх серверного предела", async () => {
  const repository = {
    findMany: async () => Array.from({ length: 1001 }, (_, index) => ({ id: `order-${index}` })),
    findFirst: async () => null,
  };
  await assert.rejects(() => loadProductionOrders(repository, undefined, "2026-10-01", "2026-11-01"), /PRODUCTION_RESULT_LIMIT_EXCEEDED/);
});

test("завершённый заказ не попадает в первую сотню производства", async () => {
  const calls = [];
  const repository = {
    findMany: async (query) => { calls.push(query); return []; },
    findFirst: async () => null,
  };
  assert.deepEqual(await loadProductionOrders(repository), []);
  assert.deepEqual(plain(calls[0].where.salesStatus.notIn), ["COMPLETED", "CANCELLED"]);
});

test("точный завершённый или отменённый заказ не возвращается в производство", async () => {
  const calls = [];
  const repository = {
    findMany: async () => [],
    findFirst: async (query) => { calls.push(query); return null; },
  };
  assert.deepEqual(plain(await loadProductionOrders(repository, "terminal-order")), []);
  assert.deepEqual(plain(calls[0].where.salesStatus.notIn), ["COMPLETED", "CANCELLED"]);
});

test("быстрая продажа не попадает в производство даже по прямой ссылке", async () => {
  const calls = [];
  const repository = {
    findMany: async (query) => { calls.push(query); return []; },
    findFirst: async (query) => { calls.push(query); return null; },
  };
  assert.deepEqual(plain(await loadProductionOrders(repository, "ready-sale")), []);
  assert.deepEqual(plain(calls[0].where.type.notIn), ["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"]);
  assert.deepEqual(plain(calls[1].where.type.notIn), ["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"]);
});
