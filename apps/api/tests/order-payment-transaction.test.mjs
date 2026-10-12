import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const nativeRequire = createRequire(import.meta.url);
const nest = class extends Error {};
const common = { BadRequestException: nest, ConflictException: nest, Injectable: () => target => target, NotFoundException: nest, ServiceUnavailableException: nest };
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;

const exchangeModule = { exports: {} };
vm.runInNewContext(compile("../src/finance/exchange-rates.ts"), { module: exchangeModule, exports: exchangeModule.exports, require: specifier => specifier === "@nestjs/common" ? common : specifier === "../prisma.service" ? { PrismaService: class {} } : nativeRequire(specifier), Buffer, AbortController, fetch, setTimeout, clearTimeout, console, Intl });

const ordersModule = { exports: {} };
let changeCurrencyImpl = async () => ({});
let persistDetailsImpl = async () => ({});
const orderRequire = specifier => {
  if (specifier === "@nestjs/common") return common;
  if (specifier === "../prisma.service") return { PrismaService: class {} };
  if (specifier === "../finance/exchange-rates") return exchangeModule.exports;
  if (specifier === "../communications/inbound-routing") return { presentClientContact: value => value };
  if (specifier === "../keycrm/keycrm-normalizer") return { keycrmSourceChannel: () => "UNKNOWN" };
  if (specifier === "../uploads") return { uploadsRoot: "uploads" };
  if (specifier === "./orders.dto") return {};
  if (specifier === "./order-archive") return { archiveOrdersTransaction: async () => ({}), OrderArchiveError: class extends Error {}, ORDER_ARCHIVE_ERROR: {} };
  if (specifier === "./order-delivery-address") return { DELIVERY_ADDRESS_ERROR: {}, DeliveryAddressOperationError: class extends Error {}, persistOrderDeliveryAddress: async () => ({}) };
  if (specifier === "./order-currency") return { changeOrderCurrencyTransaction: (...args) => changeCurrencyImpl(...args), OrderCurrencyChangeError: class extends Error {} };
  if (specifier === "./order-image-name") return { isOrderImageName: () => true };
  if (specifier === "./order-model-image") return { ORDER_MODEL_IMAGE_ERROR: {}, OrderModelImageOperationError: class extends Error {}, persistOrderModelImage: async () => ({}) };
  if (specifier === "./order-details") return { ORDER_DETAILS_ERROR: {}, OrderDetailsOperationError: class extends Error {}, persistOrderDetails: (...args) => persistDetailsImpl(...args) };
  if (specifier === "./order-item-details") return { ORDER_ITEM_DETAILS_ERROR: {}, OrderItemDetailsError: class extends Error {}, persistOrderItemDetails: async () => ({}) };
  if (specifier === "./order-file-policy") return { buildOrderFileName: () => "file.pdf", decodeOrderFile: () => ({ originalName: "file.pdf", mimeType: "application/pdf", content: Buffer.from("file") }) };
  if (specifier === "./production-rules") return { DEFAULT_PRODUCTION_DURATION_DAYS: 21, DEFAULT_SHIPPING_LEAD_DAYS: 7, productionSetting: value => Number(value), productionWindow: () => ({}), requiresProduction: type => !["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"].includes(type), resolveProductionSlotTentative: () => true, violatesShippingLead: () => false };
  if (specifier === "./production-context") return { loadProductionOrders: async () => [] };
  if (specifier === "sharp") return () => ({ metadata: async () => ({}), jpeg: () => ({ toBuffer: async () => Buffer.alloc(0) }) });
  return nativeRequire(specifier);
};
vm.runInNewContext(compile("../src/orders/orders.service.ts"), { module: ordersModule, exports: ordersModule.exports, require: orderRequire, Buffer, console, process, setTimeout, clearTimeout });
const { OrdersService } = ordersModule.exports;

const effectiveDate = (() => {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Kyiv", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const value = type => parts.find(part => part.type === type)?.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
})();

const cache = {
  version: 1,
  provider: "NBU",
  officialUrl: "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew",
  effectiveDate,
  fetchedAt: new Date().toISOString(),
  rates: [
    { baseCurrency: "EUR", quoteCurrency: "UAH", decimal: "50.3138", numerator: "251569", denominator: "5000", sourceSeriesOrValcode: "EUR" },
    { baseCurrency: "USD", quoteCurrency: "UAH", decimal: "44.8894", numerator: "224447", denominator: "5000", sourceSeriesOrValcode: "USD" },
  ],
};

test("редактирование валюты и заказа выполняется в одной транзакции с явным priceDirty", async () => {
  const tx = { marker: "same-transaction" };
  const expectedDeadline = "2026-10-20T12:00:00.000Z";
  let persisted;
  changeCurrencyImpl = async (receivedTx, orderId, currency, actorId, _now, expectedState) => {
    assert.equal(receivedTx, tx);
    assert.equal(orderId, "order-1");
    assert.equal(currency, "USD");
    assert.equal(actorId, "owner-1");
    assert.equal(expectedState.currency, "EUR");
    return { order: { id: orderId, currency: "USD", type: "CUSTOM_ORDER", notes: "Старое описание", priceMinor: 52200, requiredDeliveryAt: new Date(expectedDeadline), modelImagePath: "old.jpg" }, conversion: { provider: "ECB" } };
  };
  persistDetailsImpl = async (receivedTx, orderId, details, actorId) => {
    assert.equal(receivedTx, tx);
    persisted = { orderId, details, actorId };
    return details;
  };
  const service = new OrdersService({ $transaction: callback => callback(tx) }, {});
  await service.updateDetails("order-1", {
    currency: "USD", expectedCurrency: "EUR", priceDirty: false,
    type: "CUSTOM_ORDER", expectedType: "CUSTOM_ORDER",
    description: "Новое описание", expectedDescription: "Старое описание",
    priceMinor: 45000, expectedPriceMinor: 45000,
    requiredDeliveryAt: "2026-10-21T12:00:00.000Z", expectedRequiredDeliveryAt: expectedDeadline,
    expectedModelImagePath: "old.jpg",
  }, { id: "owner-1" });
  assert.equal(persisted.details.priceMinor, 52200);
  assert.equal(persisted.details.expectedPriceMinor, 52200);
  assert.equal(persisted.details.expectedCurrency, "USD");
});

test("валютная оплата атомарно сохраняет официальный снимок и подтверждает 50% производственный слот", async () => {
  const writes = { payment: undefined, order: undefined, slot: undefined, activities: [], audits: [], refreshes: 0 };
  const order = {
    id: "order-1", clientId: "client-1", currency: "EUR", priceMinor: 20000, depositRequiredMinor: 8000,
    productionStatus: "NOT_SCHEDULED", payments: [], productionSlot: { id: "slot-1", orderId: "order-1", tentative: true },
  };
  const tx = {
    $executeRawUnsafe: async () => 1,
    order: {
      findFirst: async () => order,
      update: async ({ data }) => (writes.order = { ...order, ...data }),
    },
    appSetting: { findUnique: async () => ({ value: cache }) },
    payment: { create: async ({ data }) => (writes.payment = { id: "payment-1", ...data }) },
    activity: { create: async ({ data }) => { writes.activities.push(data); return data; } },
    auditLog: { create: async ({ data }) => { writes.audits.push(data); return data; } },
    productionSlot: { update: async ({ data }) => (writes.slot = { ...order.productionSlot, ...data }) },
  };
  const prisma = {
    order: { findFirst: async () => ({ currency: "EUR" }) },
    $transaction: async callback => callback(tx),
  };
  const exchangeRates = { currentOrRefresh: async () => { writes.refreshes++; return cache; } };
  const service = new OrdersService(prisma, exchangeRates);

  const payment = await service.addPayment("order-1", {
    amountMinor: 10000, currency: "USD", method: "BANK_TRANSFER", receivedAt: new Date().toISOString(),
  }, { id: "owner-1" });

  assert.equal(writes.refreshes, 1);
  assert.equal(payment.amountMinor, 10000);
  assert.equal(payment.currency, "USD");
  assert.equal(payment.appliedAmountMinor, 8922);
  assert.equal(payment.appliedCurrency, "EUR");
  assert.equal(payment.exchangeRateSnapshot.provider, "NBU");
  assert.equal(writes.order.paymentStatus, "DEPOSIT_PAID");
  assert.equal(writes.order.productionStatus, "SCHEDULED");
  assert.equal(writes.slot.tentative, false);
  const confirmation = writes.activities.find(activity => activity.type === "PRODUCTION_SLOT_CONFIRMED");
  assert.deepEqual({ currency: confirmation.metadata.currency, paymentCurrency: confirmation.metadata.paymentCurrency }, { currency: "EUR", paymentCurrency: "USD" });
  assert.equal(writes.audits.some(audit => audit.entityType === "Payment"), true);
  assert.equal(writes.audits.some(audit => audit.entityType === "ProductionSlot"), true);
});

test("оплата в валюте заказа не запрашивает курс и сохраняет прежнее поведение", async () => {
  let refreshes = 0;
  const order = { id: "order-2", clientId: "client-2", currency: "EUR", priceMinor: 20000, depositRequiredMinor: 10000, productionStatus: "NOT_SCHEDULED", payments: [], productionSlot: null };
  const tx = {
    $executeRawUnsafe: async () => 1,
    order: { findFirst: async () => order, update: async ({ data }) => ({ ...order, ...data }) },
    payment: { create: async ({ data }) => ({ id: "payment-2", ...data }) },
    activity: { create: async () => ({}) }, auditLog: { create: async () => ({}) },
  };
  const service = new OrdersService({ order: { findFirst: async () => ({ currency: "EUR" }) }, $transaction: async callback => callback(tx) }, { currentOrRefresh: async () => { refreshes++; } });
  const payment = await service.addPayment("order-2", { amountMinor: 5000, currency: "EUR", method: "CARD", receivedAt: new Date().toISOString() }, { id: "owner-1" });
  assert.equal(refreshes, 0);
  assert.equal(payment.amountMinor, 5000);
  assert.equal(payment.currency, "EUR");
  assert.equal(payment.appliedAmountMinor, undefined);
  assert.equal(payment.exchangeRateSnapshot, undefined);
});
