import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const exchangeSource = readFileSync(new URL("../src/finance/exchange-rates.ts", import.meta.url), "utf8");
const exchangeJavascript = ts.transpileModule(exchangeSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true, target: ts.ScriptTarget.ES2022 } }).outputText;
const exchangeModule = { exports: {} };
const nest = class extends Error {};
vm.runInNewContext(exchangeJavascript, { module: exchangeModule, exports: exchangeModule.exports, require: specifier => specifier === "@nestjs/common" ? { BadRequestException: nest, ConflictException: nest, Injectable: () => target => target, ServiceUnavailableException: nest } : specifier === "../prisma.service" ? { PrismaService: class {} } : {}, Buffer, AbortController, fetch, setTimeout, clearTimeout, console });
const source = readFileSync(new URL("../src/orders/order-currency.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const orderModule = { exports: {} };
vm.runInNewContext(javascript, { module: orderModule, exports: orderModule.exports, require: specifier => specifier === "../finance/exchange-rates" ? exchangeModule.exports : {}, console });
const { changeOrderCurrencyTransaction, OrderCurrencyChangeError } = orderModule.exports;

const cache = {
  version: 1, provider: "NBU", officialUrl: "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew", effectiveDate: new Date().toISOString().slice(0, 10), fetchedAt: new Date().toISOString(),
  rates: [
    { baseCurrency: "EUR", quoteCurrency: "UAH", decimal: "48.196", numerator: "12049", denominator: "250", sourceSeriesOrValcode: "EUR" },
    { baseCurrency: "USD", quoteCurrency: "UAH", decimal: "41.3203", numerator: "413203", denominator: "10000", sourceSeriesOrValcode: "USD" },
  ],
};

function fixture(overrides = {}) {
  const state = { order: { id: "o1", number: "YO-26-0001", clientId: "c1", archivedAt: null, currency: "EUR", priceMinor: 10000, depositRequiredMinor: 5000, deliveryMinor: 1000, discountMinor: 250, taxMinor: 2000, giftWrapMinor: 125, productionCostMinor: 3000, sourceSystem: null, sourceLinkMode: null, payments: [], invoices: [], expenses: [], shipment: null, items: [{ id: "i1", priceMinor: 10000 }], ...overrides }, activities: [], audits: [], locks: [] };
  const tx = {
    $executeRawUnsafe: async (...args) => { state.locks.push(args); return 1; },
    appSetting: { findUnique: async ({ where }) => where.section_key.key === "exchangeRateProvider" ? { value: "NBU" } : { value: cache } },
    order: {
      findFirst: async () => structuredClone(state.order),
      update: async ({ data }) => (state.order = { ...state.order, ...data }),
    },
    orderItem: { update: async ({ where, data }) => { const item = state.order.items.find(x => x.id === where.id); Object.assign(item, data); return item; } },
    activity: { create: async ({ data }) => state.activities.push(data) },
    auditLog: { create: async ({ data }) => state.audits.push(data) },
  };
  return { tx, state };
}

test("currency change converts every order and item monetary field atomically and records exact provenance", async () => {
  const { tx, state } = fixture();
  const result = await changeOrderCurrencyTransaction(tx, "o1", "UAH", "owner-1", new Date());
  assert.equal(state.order.currency, "UAH");
  assert.equal(state.order.priceMinor, 481960);
  assert.equal(state.order.depositRequiredMinor, 240980);
  assert.equal(state.order.deliveryMinor, 48196);
  assert.equal(state.order.discountMinor, 12049);
  assert.equal(state.order.taxMinor, 96392);
  assert.equal(state.order.giftWrapMinor, 6025);
  assert.equal(state.order.productionCostMinor, 144588);
  assert.equal(state.order.items[0].priceMinor, 481960);
  assert.equal(state.activities[0].type, "ORDER_CURRENCY_CHANGED");
  assert.equal(state.audits[0].after.conversion.rate.numerator, "12049");
  assert.deepEqual(JSON.parse(JSON.stringify(state.audits[0].after.conversion.sourceObservations)), [{
    baseCurrency: "EUR", quoteCurrency: "UAH", decimal: "48.196", numerator: "12049", denominator: "250", sourceSeriesOrValcode: "EUR",
  }]);
  assert.equal(state.audits[0].after.conversion.officialUrl, cache.officialUrl);
  assert.equal(state.audits[0].after.conversion.effectiveDate, cache.effectiveDate);
  assert.equal(state.locks[0][1], "yoleotard-exchange-rates");
  assert.equal(result.conversion.provider, "NBU");
});

test("currency change rejects a stale order snapshot before monetary writes", async () => {
  const { tx, state } = fixture();
  await assert.rejects(
    () => changeOrderCurrencyTransaction(tx, "o1", "UAH", "owner-1", new Date(), {
      currency: "EUR", type: "CUSTOM_ORDER", description: "Устаревшее описание", priceMinor: 10000,
      requiredDeliveryAt: null, modelImagePath: null,
    }),
    error => error instanceof OrderCurrencyChangeError && error.code === "ORDER_CHANGED",
  );
  assert.equal(state.order.currency, "EUR");
  assert.equal(state.activities.length, 0);
  assert.equal(state.audits.length, 0);
});

test("currency change rejects a converted Prisma Int overflow before monetary writes", async () => {
  const { tx, state } = fixture({ priceMinor: 2_147_483_647, items: [{ id: "i1", priceMinor: 2_147_483_647 }] });
  await assert.rejects(
    () => changeOrderCurrencyTransaction(tx, "o1", "UAH", "owner-1", new Date()),
    error => error instanceof OrderCurrencyChangeError && error.code === "AMOUNT_OUT_OF_RANGE",
  );
  assert.equal(state.order.currency, "EUR");
  assert.equal(state.order.priceMinor, 2_147_483_647);
  assert.equal(state.order.items[0].priceMinor, 2_147_483_647);
  assert.equal(state.activities.length, 0);
  assert.equal(state.audits.length, 0);
});

for (const [name, overrides] of [
  ["payment", { payments: [{ id: "p1" }] }],
  ["invoice", { invoices: [{ id: "v1" }] }],
  ["expense", { expenses: [{ id: "e1", amountMinor: 100, currency: "EUR" }] }],
  ["shipment cost", { shipment: { id: "s1", costMinor: 1 } }],
  ["provider-owned KeyCRM order", { sourceSystem: "KEYCRM", sourceLinkMode: "IMPORTED" }],
]) test(`currency change fails closed for ${name}`, async () => {
  const { tx, state } = fixture(overrides);
  await assert.rejects(() => changeOrderCurrencyTransaction(tx, "o1", "USD", "owner-1", new Date()), error => error instanceof OrderCurrencyChangeError);
  assert.equal(state.order.currency, "EUR");
  assert.equal(state.activities.length, 0);
  assert.equal(state.audits.length, 0);
});

test("stale or mismatched cache fails closed", async () => {
  const { tx } = fixture();
  tx.appSetting.findUnique = async ({ where }) => where.section_key.key === "exchangeRateProvider" ? { value: "ECB" } : { value: { ...cache, provider: "NBU", fetchedAt: "2025-01-01T00:00:00.000Z" } };
  await assert.rejects(() => changeOrderCurrencyTransaction(tx, "o1", "USD", "owner-1", new Date("2026-10-11T00:00:00Z")), /обновите курсы/);
});

test("fresh fetch time cannot make an old official observation usable", async () => {
  const { tx, state } = fixture();
  tx.appSetting.findUnique = async ({ where }) => where.section_key.key === "exchangeRateProvider"
    ? { value: "NBU" }
    : { value: { ...cache, effectiveDate: "2026-09-01", fetchedAt: "2026-10-11T23:00:00.000Z" } };
  await assert.rejects(
    () => changeOrderCurrencyTransaction(tx, "o1", "USD", "owner-1", new Date("2026-10-12T08:00:00.000Z")),
    /обновите курсы/,
  );
  assert.equal(state.order.currency, "EUR");
});
