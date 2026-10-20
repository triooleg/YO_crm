import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { aggregateShippingStatus } from "../src/shipping/shipping-status.ts";
import { calculateShippingFinance, shippingCustomerCharge } from "../src/shipping/shipping-finance.ts";

const nativeRequire = createRequire(import.meta.url);
function loadModule(relative, dependencies = {}) {
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: specifier => dependencies[specifier] ?? (specifier === "../prisma.service" ? {} : nativeRequire(specifier)), Date, console });
  return module.exports;
}
const fx = loadModule("../src/finance/exchange-rates.ts");
function loadShippingService() {
  const source = readFileSync(new URL("../src/shipping/shipping.service.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true } }).outputText;
  const module = { exports: {} };
  const localRequire = specifier => {
    if (specifier === "../prisma.service") return { PrismaService: class PrismaService {} };
    if (specifier === "../finance/exchange-rates") return fx;
    if (specifier === "./shipping-conversion") return loadModule("../src/shipping/shipping-conversion.ts", { "../finance/exchange-rates": fx });
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

test("parcel carrier expense keeps its selected currency separately from customer delivery", async () => {
  let expense, parcel;
  const order = { id: "order-1", clientId: "client-1", currency: "EUR", priceMinor: 10000, deliveryMinor: 0, depositRequiredMinor: 5000, paymentStatus: "UNPAID", orderShipments: [] };
  const tx = {
    $executeRawUnsafe: async () => 1,
    order: { findFirst: async () => order },
    appSetting: { findUnique: async () => null },
    orderItemInstance: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    expenseCategory: { findFirst: async () => ({ id: "delivery-category" }) },
    expense: { findUnique: async () => null, create: async ({ data }) => (expense = { id: "expense-1", ...data }) },
    orderShipment: { create: async ({ data }) => (parcel = { id: "parcel-1", ...data }) },
    activity: { create: async () => ({}) }, auditLog: { create: async () => ({}) },
  };
  const Service = loadShippingService(), service = new Service({ $transaction: callback => callback(tx) });
  // Aggregate recalculation is covered separately; inspect its persisted inputs here.
  service.refreshOrderShipping = async () => {};
  await service.createShipment("order-1", {
    carrier: "NOVA_POSHTA", status: "NOT_READY", customerChargeMinor: 1500,
    atelierCostMinor: 82550, currency: "EUR", atelierCostCurrency: "UAH", instanceIds: [],
  }, { id: "manager-1" });
  assert.equal(expense.amountMinor, 82550);
  assert.equal(expense.currency, "UAH");
  assert.equal(parcel.customerChargeMinor, 1500);
  assert.equal(parcel.currency, "EUR");
  assert.equal(parcel.atelierExpenseId, expense.id);
});

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
      findUniqueOrThrow: async () => ({ id: "order-1", currency: "EUR", priceMinor: 11000, deliveryMinor: 1000, depositRequiredMinor: 5500, paymentStatus: "PARTIALLY_PAID", payments: [{ amountMinor: 6000, currency: "EUR" }], productionSlot: null }),
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
      findUniqueOrThrow: async () => ({ id: "order-1", clientId: "client-1", type: "INDIVIDUAL", productionStatus: "NOT_SCHEDULED", currency: "EUR", priceMinor: 12000, deliveryMinor: 2000, depositRequiredMinor: 6000, paymentStatus: "PARTIALLY_PAID", payments: [{ amountMinor: 5500, currency: "EUR" }], productionSlot: { id: "slot-1", tentative: true } }),
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


function shippingHarness({ current = null, cache = rateCache(), provider = cache.provider, extraParcels = [], refreshError, beforeTransaction, expenseOverrides = {}, missingDeliveryCategory = false } = {}) {
  const events = [], audits = [], writes = [];
  const order = { id: "o", clientId: "c", currency: "EUR", priceMinor: 10000 + (current?.customerChargeMinor ?? 0), deliveryMinor: current?.customerChargeMinor ?? 0, depositRequiredMinor: 5000, paymentStatus: "UNPAID", shippingStatus: "NOT_READY", payments: [], productionSlot: null };
  let parcel = current;
  const expense = current?.atelierExpenseId ? { id: current.atelierExpenseId, currency: "UAH", amountMinor: current.atelierCostMinor, incurredAt: new Date("2026-10-01"), ...expenseOverrides } : null;
  const getOrder = () => ({ ...order, orderShipments: [...extraParcels, ...(parcel ? [parcel] : [])], shipment: parcel ? { updatedAt: parcel.updatedAt } : null });
  const write = (kind, data) => { writes.push(kind); return data.customerChargeRateSnapshot === nativeRequire("@prisma/client").Prisma.DbNull ? { ...data, customerChargeRateSnapshot: null } : data; };
  const tx = {
    $executeRawUnsafe: async (_, lock) => { events.push(lock); },
    order: { findFirst: async () => getOrder(), findUniqueOrThrow: async () => getOrder(), update: async ({ data }) => Object.assign(order, write("order", data)) },
    appSetting: { findUnique: async ({ where }) => ({ value: where.section_key.key === "exchangeRateCache" ? cache : where.section_key.key === "exchangeRateProvider" ? provider : {} }) },
    orderShipment: {
      findFirst: async () => parcel, findMany: async () => [...extraParcels, ...(parcel ? [parcel] : [])],
      create: async ({ data }) => (parcel = { id: "s", updatedAt: new Date("2026-10-18"), ...write("parcel", data) }),
      update: async ({ data }) => (parcel = { ...parcel, ...write("parcel", data) }),
    },
    orderItemInstance: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
    expenseCategory: { findFirst: async () => missingDeliveryCategory ? null : ({ id: "cat" }) },
    expense: { findUnique: async () => expense, create: async ({ data }) => ({ id: "e", ...write("expense", data) }), update: async ({ data }) => ({ ...expense, ...write("expense", data) }) },
    shipment: { upsert: async ({ create, update }) => write("legacy", { ...create, ...update }) },
    activity: { create: async () => ({}) }, auditLog: { create: async ({ data }) => { audits.push(data); return {}; } },
  };
  const Service = loadShippingService();
  const service = new Service({ order: tx.order, $transaction: async callback => { events.push("transaction"); await beforeTransaction?.(order); return callback(tx); } }, { currentOrRefresh: async () => { events.push("refresh"); if (refreshError) throw refreshError; return cache; } });
  const dto = { carrier: "DHL", status: "NOT_READY", currency: "EUR", customerChargeMinor: 1001, customerChargeCurrency: "USD", atelierCostMinor: 0, instanceIds: [], ...(current ? { expectedUpdatedAt: current.updatedAt.toISOString() } : {}) };
  return { service, dto, events, audits, writes, order, parcel: () => parcel };
}
function rateCache() {
  const now = new Date();
  return { version: 1, provider: "NBU", officialUrl: "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew", effectiveDate: now.toISOString().slice(0, 10), fetchedAt: now.toISOString(), rates: [
    { baseCurrency: "EUR", quoteCurrency: "UAH", decimal: "50", numerator: "50", denominator: "1", sourceSeriesOrValcode: "EUR" },
    { baseCurrency: "USD", quoteCurrency: "UAH", decimal: "25", numerator: "25", denominator: "1", sourceSeriesOrValcode: "USD" },
  ] };
}
const actor = { id: "u" };

test("foreign customer charge uses exact half-up applied amount, independent expense, audit and multipart aggregate", async () => {
  const h = shippingHarness({ extraParcels: [{ id: "other", status: "READY", customerChargeMinor: 800, currency: "EUR" }] });
  const result = await h.service.createShipment("o", { ...h.dto, atelierCostMinor: 82550, atelierCostCurrency: "UAH" }, actor);
  assert.equal(result.customerChargeMinor, 501);
  assert.equal(result.currency, "EUR");
  assert.equal(result.customerChargeOriginalMinor, 1001);
  assert.equal(result.customerChargeOriginalCurrency, "USD");
  assert.equal(result.customerChargeRateSnapshot.from, "USD");
  assert.equal(result.customerChargeRateSnapshot.to, "EUR");
  assert.equal(result.customerChargeRateSnapshot.rate.numerator, "1");
  assert.equal(result.customerChargeRateSnapshot.rate.denominator, "2");
  assert.equal(h.order.deliveryMinor, 1301);
  assert.equal(h.order.priceMinor, 11301);
  assert.equal(h.order.depositRequiredMinor, 5651);
  assert.equal(h.audits.find(a => a.entityType === "Expense").after.currency, "UAH");
  assert.equal(h.audits.find(a => a.entityType === "OrderShipment").after.customerChargeRateSnapshot, result.customerChargeRateSnapshot);
  assert.deepEqual(h.events, ["refresh", "transaction", "yoleotard-exchange-rates", "o"]);
});

function savedForeign(overrides = {}) {
  return { id: "s", orderId: "o", carrier: "DHL", status: "NOT_READY", currency: "EUR", customerChargeMinor: 501, customerChargeOriginalMinor: 1001, customerChargeOriginalCurrency: "USD", customerChargeRateSnapshot: fx.buildPaymentConversion(rateCache(), 1001, "USD", "EUR").snapshot, atelierCostMinor: 100, atelierExpenseId: "e", updatedAt: new Date("2026-10-18T00:00:00Z"), ...overrides };
}
for (const missingDeliveryCategory of [false, true]) test(`shipment save preserves accountant expense category and notes; missing default=${missingDeliveryCategory}`, async () => {
  const h = shippingHarness({ current: savedForeign(), missingDeliveryCategory, expenseOverrides: { categoryId: "accountant-category", notes: "Accountant reference" } });
  await h.service.updateShipment("o", "s", { ...h.dto, status: "READY", atelierCostMinor: 82550, atelierCostCurrency: "UAH" }, actor);
  const saved = h.audits.find(row => row.entityType === "Expense").after;
  assert.equal(saved.categoryId, "accountant-category"); assert.equal(saved.notes, "Accountant reference");
  assert.equal(saved.amountMinor, 82550); assert.equal(saved.currency, "UAH");
});
test("a linked Finance version ahead of the clock stays monotonic and repeated stale parcel PUTs reject", async () => {
  const current = savedForeign({ updatedAt: new Date("2099-01-01T00:00:00Z") });
  const h = shippingHarness({ current, refreshError: new Error("must not fetch") });
  const result = await h.service.updateShipment("o", "s", h.dto, actor);
  assert.ok(result.updatedAt.getTime() > current.updatedAt.getTime());
  await assert.rejects(() => h.service.updateShipment("o", "s", h.dto, actor), /изменена другим/);
});
for (const field of ["officialUrl", "effectiveDate", "fetchedAt", "sourceRates", "sourceObservations"]) test(`incomplete saved ${field} fails closed without refreshing the historical charge`, async () => {
  const current = savedForeign(); delete current.customerChargeRateSnapshot[field];
  const h = shippingHarness({ current, refreshError: new Error("must not fetch") });
  await assert.rejects(() => h.service.updateShipment("o", "s", h.dto, actor), /история конвертации/);
  assert.deepEqual(h.events, []); assert.deepEqual(h.writes, []);
});
for (const legacy of [false, true]) test(`unchanged ${legacy ? "legacy applied" : "original"} save preserves exact snapshot without consulting unavailable FX`, async () => {
  const current = savedForeign();
  // Historical evidence is allowed to outlive the freshness window for new conversions.
  current.customerChargeRateSnapshot.fetchedAt = "2020-01-01T00:00:00Z";
  const h = shippingHarness({ current, cache: {}, provider: "ECB", refreshError: new Error("must not fetch") });
  const result = await h.service.updateShipment("o", "s", { ...h.dto, status: "READY", ...(legacy ? { customerChargeCurrency: undefined, customerChargeMinor: 501 } : {}) }, actor);
  assert.equal(result.customerChargeMinor, 501);
  assert.equal(result.customerChargeRateSnapshot, current.customerChargeRateSnapshot);
  assert.equal(result.customerChargeOriginalMinor, 1001);
  assert.equal(h.events.includes("refresh"), false);
  assert.equal(h.audits.find(a => a.entityType === "Expense").after.currency, "UAH");
});
for (const input of [{ customerChargeMinor: 0, customerChargeCurrency: "UAH" }, { customerChargeMinor: 700, customerChargeCurrency: "EUR" }, { customerChargeMinor: 700, customerChargeCurrency: undefined }]) test(`economic reset ${JSON.stringify(input)} clears old FX without refresh`, async () => {
  const h = shippingHarness({ current: savedForeign(), refreshError: new Error("must not fetch") });
  const result = await h.service.updateShipment("o", "s", { ...h.dto, ...input }, actor);
  assert.equal(result.customerChargeMinor, input.customerChargeMinor);
  assert.equal(result.customerChargeOriginalMinor, null);
  assert.equal(result.customerChargeOriginalCurrency, null);
  assert.equal(result.customerChargeRateSnapshot, null);
  assert.equal(h.events.includes("refresh"), false);
  assert.equal(h.audits.find(a => a.entityType === "OrderShipment").before.customerChargeOriginalMinor, 1001);
});
test("changing the foreign original obtains a new authoritative conversion", async () => {
  const h = shippingHarness({ current: savedForeign() });
  const result = await h.service.updateShipment("o", "s", { ...h.dto, customerChargeMinor: 2000 }, actor);
  assert.equal(result.customerChargeMinor, 1000);
  assert.equal(result.customerChargeOriginalMinor, 2000);
  assert.equal(h.events[0], "refresh");
});
for (const input of [{ customerChargeMinor: 0, customerChargeCurrency: "UAH" }, { customerChargeMinor: 1500, customerChargeCurrency: "EUR" }, { customerChargeMinor: 1500, customerChargeCurrency: undefined }]) test(`new no-FX charge ${JSON.stringify(input)} needs no provider`, async () => {
  const h = shippingHarness({ refreshError: new Error("must not fetch") });
  const result = await h.service.createShipment("o", { ...h.dto, ...input }, actor);
  assert.equal(result.customerChargeMinor, input.customerChargeMinor);
  assert.equal(result.customerChargeRateSnapshot, null);
  assert.equal(h.events.includes("refresh"), false);
});
for (const mode of ["stale", "missing", "provider changed", "unsupported", "overflow", "refresh unavailable"]) test(`new FX fails closed before any business writes: ${mode}`, async () => {
  let cache = rateCache(), provider = "NBU", input = {}, refreshError;
  if (mode === "stale") cache.effectiveDate = "2020-01-01";
  if (mode === "missing") cache = {};
  if (mode === "provider changed") provider = "ECB";
  if (mode === "unsupported") {
    cache = { ...cache, provider: "ECB", officialUrl: "https://data.ecb.europa.eu/help/api/data", rates: [{ baseCurrency: "EUR", quoteCurrency: "USD", decimal: "1.2", numerator: "6", denominator: "5", sourceSeriesOrValcode: "EXR/D.USD.EUR.SP00.A" }] };
    provider = "ECB"; input.customerChargeCurrency = "UAH";
  }
  if (mode === "overflow") { cache.rates[0] = { ...cache.rates[0], decimal: "0.01", numerator: "1", denominator: "100" }; input.customerChargeMinor = 100000000; }
  if (mode === "refresh unavailable") refreshError = new Error("provider unavailable");
  const h = shippingHarness({ cache, provider, refreshError });
  await assert.rejects(() => h.service.createShipment("o", { ...h.dto, ...input }, actor));
  assert.deepEqual(h.writes, []);
  assert.deepEqual(h.audits, []);
});
test("post-refresh order currency race fails closed", async () => {
  const h = shippingHarness({ beforeTransaction: order => { order.currency = "USD"; } });
  await assert.rejects(() => h.service.createShipment("o", h.dto, actor));
  assert.deepEqual(h.writes, []);
});
test("stale parcel version rejects without fetching FX", async () => {
  const h = shippingHarness({ current: savedForeign() });
  await assert.rejects(() => h.service.updateShipment("o", "s", { ...h.dto, expectedUpdatedAt: "2026-01-01", customerChargeMinor: 5000 }, actor), /другим пользователем/);
  assert.deepEqual(h.events, []);
  assert.deepEqual(h.writes, []);
});
for (const invalid of [{ customerChargeOriginalCurrency: null }, { customerChargeRateSnapshot: null }, { customerChargeMinor: 500 }, { customerChargeOriginalMinor: -1 }]) test(`malformed persisted provenance fails closed ${JSON.stringify(invalid)}`, async () => {
  const h = shippingHarness({ current: savedForeign(invalid) });
  await assert.rejects(() => h.service.updateShipment("o", "s", h.dto, actor));
  assert.deepEqual(h.writes, []);
});
test("a positive foreign original rounded to applied zero cannot be archived", async () => {
  const current = savedForeign({ customerChargeMinor: 0, customerChargeOriginalMinor: 1, atelierCostMinor: 0, atelierExpenseId: null });
  const h = shippingHarness({ current });
  await assert.rejects(() => h.service.archiveShipment("o", "s", current.updatedAt.toISOString(), actor), /нельзя удалить/);
  assert.deepEqual(h.writes, []);
});
for (const cost of [501, 800]) test(`legacy singleton cost ${cost} preserves or clears foreign evidence coherently`, async () => {
  const current = savedForeign(), h = shippingHarness({ current });
  await h.service.upsert("o", { carrier: "DHL", currency: "EUR", costMinor: cost, status: "NOT_READY", expectedUpdatedAt: current.updatedAt.toISOString() }, actor);
  assert.equal(h.parcel().customerChargeMinor, cost);
  assert.equal(h.parcel().customerChargeOriginalMinor, cost === 501 ? 1001 : null);
  assert.equal(h.parcel().customerChargeRateSnapshot, cost === 501 ? current.customerChargeRateSnapshot : null);
  assert.equal(h.events.includes("refresh"), false);
});
test("multipart applied aggregate Int overflow rejects before writing", async () => {
  const h = shippingHarness({ extraParcels: [{ id: "other", status: "READY", customerChargeMinor: 2147483647, currency: "EUR" }] });
  await assert.rejects(() => h.service.createShipment("o", h.dto, actor), /диапазон|сумма/i);
  assert.deepEqual(h.writes, []);
});


for (const field of ["customerChargeCurrency", "atelierCostCurrency"]) {
  test(`DTO rejects explicit null ${field} while accepting omission and supported currencies`, () => {
    nativeRequire("reflect-metadata");
    const { UpsertOrderShipmentDto } = loadModule("../src/shipping/shipping.dto.ts");
    const { validateSync } = nativeRequire("class-validator");
    const errors = value => validateSync(Object.assign(new UpsertOrderShipmentDto(), { [field]: value })).filter(error => error.property === field);
    assert.equal(errors(null).length, 1);
    assert.equal(errors(null)[0].constraints.isIn !== undefined, true);
    for (const value of [undefined, "EUR", "USD", "UAH"]) assert.equal(errors(value).length, 0);
  });
  for (const amount of [0, 1001]) for (const update of [false, true]) test(`service rejects explicit null ${field}, amount ${amount}, ${update ? "update" : "create"} before FX or writes`, async () => {
    const h = shippingHarness({ current: update ? savedForeign() : null });
    const input = { ...h.dto, customerChargeMinor: amount, atelierCostMinor: amount, [field]: null };
    await assert.rejects(() => update ? h.service.updateShipment("o", "s", input, actor) : h.service.createShipment("o", input, actor), /сумма или валюта доставки/);
    assert.deepEqual(h.events, []);
    assert.deepEqual(h.writes, []);
    assert.deepEqual(h.audits, []);
  });
}
