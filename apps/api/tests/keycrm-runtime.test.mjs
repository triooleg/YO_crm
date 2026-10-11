import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { OrderType } from "@prisma/client";
import ts from "typescript";
import { KeycrmClient } from "../src/keycrm/keycrm-client.ts";
import { hasUsableDeliveryAddress, matchedShippingCarrier, nextDepositRequired, normalizedPhoneDigits } from "../src/keycrm/keycrm-sync-policy.ts";

const nativeRequire = createRequire(import.meta.url);

function loadKeycrmService() {
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === "../prisma.service") return { PrismaService: class PrismaService {} };
    if (specifier === "../secret-box") return { decryptSecret: value => value, encryptSecret: value => value };
    if (specifier === "./keycrm-client") return { KeycrmClient: class KeycrmClient {}, KEYCRM_API_URL: "https://openapi.keycrm.app/v1" };
    if (specifier === "./keycrm-normalizer") return { normalizeKeycrmOrder: value => value };
    if (specifier === "./keycrm-sync-policy") return { hasUsableDeliveryAddress, matchedShippingCarrier, nextDepositRequired, normalizedPhoneDigits };
    if (specifier === "./keycrm.dto") return {};
    return nativeRequire(specifier);
  };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: localRequire, console, process, Buffer, setTimeout, clearTimeout });
  return module.exports.KeycrmService;
}

test("временная ошибка KeyCRM 5xx переводится в retryable сбой", async () => {
  const client = new KeycrmClient("secret", async () => new Response("temporary", { status: 503 }));
  await assert.rejects(() => client.testConnection(), /временно недоступен/);
});

test("страницы справочника источников загружаются последовательно", async () => {
  const pages = [];
  const client = new KeycrmClient("secret", async (input) => {
    const url = new URL(input);
    pages.push(url.searchParams.get("page"));
    return Response.json({ data: [], total: 0, current_page: Number(url.searchParams.get("page")), per_page: 50 });
  });
  await client.listSources(1);
  await client.listSources(2);
  assert.deepEqual(pages, ["1", "2"]);
});

test("worker освобождает lease между страницами справочника источников", async () => {
  const KeycrmService = loadKeycrmService();
  const run = {
    id: "run-1", status: "RUNNING", startedAt: new Date(), startedById: "user-1",
    leaseOwner: "worker-1", leaseUntil: new Date(Date.now() + 60_000), configRevision: 1,
    context: null, currentPage: 1, pageSize: 50, requestedFrom: null, requestedTo: new Date(),
  };
  const sourcePages = [];
  const prisma = {
    keycrmSyncRun: {
      findUnique: async ({ select }) => select?.context ? { context: run.context } : run,
      update: async ({ data }) => { Object.assign(run, data); return run; },
    },
  };
  const service = new KeycrmService(prisma);
  service.settings = async () => ({ enabled: true, endpoint: "https://openapi.keycrm.app/v1", apiTokenConfigured: true, connectionStatus: "VERIFIED", verifiedAt: null, lastErrorCode: null, pageSize: 50, defaultCurrency: "EUR", defaultOrderType: OrderType.CUSTOM_ORDER, connectionKey: "connection-1", configRevision: 1 });
  service.client = async () => ({
    listSources: async (page) => {
      sourcePages.push(page);
      return page === 1
        ? { data: [{ id: 1, name: "Site", currency_code: "EUR" }], total: 51, per_page: 50 }
        : { data: [{ id: 2, name: "Instagram", currency_code: "USD" }], total: 51, per_page: 50 };
    },
  });

  await service.processStep(run.id, "worker-1");
  assert.equal(run.leaseOwner, null);
  assert.equal(run.leaseUntil, null);
  assert.equal(run.context.sourcePage, 2);
  assert.equal(run.context.sourcesComplete, false);

  run.leaseOwner = "worker-1";
  run.leaseUntil = new Date(Date.now() + 60_000);
  await service.processStep(run.id, "worker-1");
  assert.deepEqual(sourcePages, [1, 2]);
  assert.equal(run.context.sourcesComplete, true);
  assert.deepEqual(JSON.parse(JSON.stringify(run.context.sourceCurrencies)), { "1": "EUR", "2": "USD" });
});

test("повторная синхронизация обновляет стандартный депозит, но сохраняет ручной", () => {
  assert.equal(nextDepositRequired(10000, 20000, OrderType.CUSTOM_ORDER, 15000), 15000);
  assert.equal(nextDepositRequired(7000, 20000, OrderType.CUSTOM_ORDER, 15000), 7000);
  assert.equal(nextDepositRequired(0, 20000, OrderType.READY_MODEL, 0), 0);
});

test("город или страна без строки адреса не считаются готовым адресом доставки", () => {
  assert.equal(hasUsableDeliveryAddress(null), false);
  assert.equal(hasUsableDeliveryAddress("   "), false);
  assert.equal(hasUsableDeliveryAddress("Крещатик, 1"), true);
});

test("форматированный номер сравнивается по нормализованным цифрам", () => {
  assert.equal(normalizedPhoneDigits("+38 (050) 123-45-67"), "380501234567");
  assert.equal(normalizedPhoneDigits("123"), null);
});

test("неизвестная служба KeyCRM не создаёт несовместимый enum доставки", () => {
  assert.equal(matchedShippingCarrier("Nova Poshta"), "NOVA_POSHTA");
  assert.equal(matchedShippingCarrier("Нова Пошта Global"), "NOVA_GLOBAL");
  assert.equal(matchedShippingCarrier("Ukrposhta"), "UKRPOSHTA");
  assert.equal(matchedShippingCarrier("DHL Express"), "DHL");
  assert.equal(matchedShippingCarrier("Local courier"), null);
});

test("параллельные сохранения настроек получают разные последовательные ревизии", async () => {
  const KeycrmService = loadKeycrmService();
  const values = new Map([
    ["connectionKey", "connection-1"],
    ["configRevision", 1],
    ["pageSize", 50],
    ["defaultCurrency", "EUR"],
    ["defaultOrderType", OrderType.CUSTOM_ORDER],
  ]);
  const revisions = [];
  const appSetting = {
    findMany: async () => [...values].map(([key, value]) => ({ key, value })),
    upsert: async ({ where, create, update }) => {
      values.set(where.section_key.key, values.has(where.section_key.key) ? update.value : create.value);
      if (where.section_key.key === "configRevision") revisions.push(values.get("configRevision"));
    },
  };
  const tx = {
    appSetting,
    $executeRawUnsafe: async () => undefined,
    keycrmSyncRun: { count: async () => 0 },
    order: { count: async () => 0 },
    auditLog: { create: async () => undefined },
  };
  let serialized = Promise.resolve();
  const prisma = {
    appSetting,
    $transaction: (callback) => {
      const result = serialized.then(() => callback(tx));
      serialized = result.catch(() => undefined);
      return result;
    },
  };
  const service = new KeycrmService(prisma);
  await Promise.all([
    service.saveSettings({ pageSize: 25 }, { id: "owner-1" }),
    service.saveSettings({ pageSize: 30 }, { id: "owner-1" }),
  ]);
  assert.deepEqual(revisions, [2, 3]);
  assert.equal(values.get("configRevision"), 3);
});

test("повторная синхронизация принимает buyer link через redirect и сохраняет возможность split", async () => {
  const KeycrmService = loadKeycrmService();
  const service = new KeycrmService({});
  const updates = [];
  const tx = {
    clientMergeRedirect: { findUnique: async ({ where }) => where.sourceClientId === "source" ? { targetClientId: "target" } : null },
    client: {
      findUniqueOrThrow: async () => ({ id: "target", email: "buyer@example.com", phone: null, country: null, city: null, address: null, postalCode: null }),
      update: async () => { throw new Error("client fields must not change"); },
    },
    keycrmClientLink: {
      findUnique: async () => ({ id: "link-1", clientId: "source", connectionKey: "connection-1", keycrmBuyerId: "buyer-1" }),
      update: async ({ data }) => { updates.push(data); return { id: "link-1", clientId: data.clientId || "source", ...data }; },
    },
    auditLog: { create: async () => undefined },
  };
  const order = {
    sourceAccount: "connection-1",
    client: {
      keycrmBuyerId: "buyer-1", sourcePayload: {}, email: "buyer@example.com", phone: null,
      country: null, city: null, address: null, postalCode: null,
    },
  };
  const clientId = await service.attachBuyerToExistingClient(tx, order, "owner-1", "target");
  assert.equal(clientId, "target");
  assert.equal(updates[0].clientId, undefined);
});

test("создание запуска и сохранение настроек не оставляют запуск со старой ревизией", async () => {
  const KeycrmService = loadKeycrmService();
  const values = new Map([
    ["enabled", true], ["apiTokenEncrypted", "secret"], ["connectionStatus", "VERIFIED"],
    ["connectionKey", "connection-1"], ["configRevision", 1], ["pageSize", 50],
    ["defaultCurrency", "EUR"], ["defaultOrderType", OrderType.CUSTOM_ORDER],
  ]);
  const runs = [];
  let releaseCreate;
  const createGate = new Promise(resolve => { releaseCreate = resolve; });
  let createReachedResolve;
  const createReached = new Promise(resolve => { createReachedResolve = resolve; });
  const appSetting = {
    findMany: async () => [...values].map(([key, value]) => ({ key, value })),
    upsert: async ({ where, create, update }) => values.set(where.section_key.key, values.has(where.section_key.key) ? update.value : create.value),
  };
  const keycrmSyncRun = {
    findUnique: async ({ where }) => runs.find(row => row.clientRequestId === where.clientRequestId || row.id === where.id) || null,
    count: async () => runs.filter(row => ["PENDING", "RUNNING"].includes(row.status)).length,
    create: async ({ data }) => {
      createReachedResolve();
      await createGate;
      const row = { id: "run-1", ...data };
      runs.push(row);
      return row;
    },
  };
  const tx = {
    appSetting, keycrmSyncRun,
    $executeRawUnsafe: async () => undefined,
    order: { count: async () => 0 },
    auditLog: { create: async () => undefined },
  };
  let serialized = Promise.resolve();
  const prisma = {
    appSetting, keycrmSyncRun,
    auditLog: tx.auditLog,
    $transaction: callback => {
      const result = serialized.then(() => callback(tx));
      serialized = result.catch(() => undefined);
      return result;
    },
  };
  const service = new KeycrmService(prisma);
  const createPromise = service.createRun({ dryRun: true, clientRequestId: "5d78f692-58d4-4f7a-b03c-f019a37a9724" }, { id: "owner-1" });
  await createReached;
  const savePromise = service.saveSettings({ pageSize: 25 }, { id: "owner-1" });
  releaseCreate();
  const run = await createPromise;
  await assert.rejects(savePromise, /активной синхронизации/);
  assert.equal(run.configRevision, 1);
  assert.equal(values.get("configRevision"), 1);
});

function normalizedOrder(overrides = {}) {
  return {
    sourceAccount: "connection-1", externalId: "order-1", externalNumber: "K-1", externalUpdatedAt: new Date("2026-10-02T00:00:00Z"),
    number: "K-1", orderedAt: new Date("2026-10-01T00:00:00Z"), type: OrderType.CUSTOM_ORDER,
    salesStatus: "NEW", productionStatus: "NOT_SCHEDULED", paymentStatus: "UNPAID", shippingStatus: "NOT_READY",
    priceMinor: 10000, currency: "EUR", depositRequiredMinor: 5000, deliveryMinor: 0, discountMinor: 0, taxMinor: 0, giftWrapMinor: 0,
    requiredDeliveryAt: null, buyerComment: null, managerComment: null, giftMessage: null, promocode: null, isGift: false,
    sourceName: "Site", externalData: {},
    client: { keycrmBuyerId: null, sourcePayload: {}, firstName: "Buyer", displayName: "Buyer", email: null, phone: null, country: null, city: null, address: null, postalCode: null, source: "OTHER" },
    delivery: { addressLine1: null, addressLine2: null, city: null, region: null, postalCode: null, addressText: null, serviceId: null, serviceName: null, trackingCode: null, externalStatus: null },
    items: [], payments: [], ...overrides,
  };
}

test("смена валюты связанного ручного заказа прекращает импорт до мутаций", async () => {
  const KeycrmService = loadKeycrmService();
  const issues = [];
  const existing = { id: "order-local", number: "YO-26-0001", clientId: "client-1", sourceLinkMode: "MATCHED_EXISTING", currency: "EUR", externalUpdatedAt: new Date("2026-10-01T00:00:00Z") };
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined,
    order: { findUnique: async () => existing, update: async () => { throw new Error("order must not change"); } },
    keycrmSyncIssue: { create: async ({ data }) => { issues.push(data); } },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  const result = await service.importOrder(normalizedOrder({ currency: "USD" }), "owner-1", "run-1");
  assert.equal(result, "SKIPPED");
  assert.equal(issues[0].code, "MATCHED_ORDER_CURRENCY_CHANGED");
});

test("preview и apply одинаково пропускают смену валюты связанного ручного заказа", async () => {
  const KeycrmService = loadKeycrmService();
  const issues = [];
  const existing = { id: "order-local", number: "YO-26-0001", sourceLinkMode: "MATCHED_EXISTING", currency: "EUR", externalUpdatedAt: new Date("2026-10-01T00:00:00Z") };
  const service = new KeycrmService({
    order: { findUnique: async () => existing },
    keycrmSyncIssue: { create: async ({ data }) => { issues.push(data); } },
  });
  const result = await service.previewOrder(normalizedOrder({ currency: "USD" }), "run-preview");
  assert.equal(result, "SKIPPED");
  assert.equal(issues[0].code, "MATCHED_ORDER_CURRENCY_CHANGED");
});

test("запоздавшая проверка подключения не перезаписывает новую ревизию настроек", async () => {
  const KeycrmService = loadKeycrmService();
  const values = new Map([["configRevision", 2], ["connectionStatus", "VERIFIED"]]);
  const writes = [];
  const tx = {
    $executeRawUnsafe: async () => undefined,
    appSetting: {
      findMany: async () => [...values].map(([key, value]) => ({ key, value })),
      upsert: async ({ where, update }) => { writes.push(where.section_key.key); values.set(where.section_key.key, update.value); },
    },
    auditLog: { create: async () => undefined },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  const persisted = await service.persistConnectionState("ERROR", "", "KEYCRM_UNAUTHORIZED", "owner-1", 1);
  assert.equal(persisted, false);
  assert.deepEqual(writes, []);
  assert.equal(values.get("connectionStatus"), "VERIFIED");
});

test("ручные позиции и неоднозначные оплаты связанного заказа остаются неизменными", async () => {
  const KeycrmService = loadKeycrmService();
  const issues = [];
  const writes = { item: 0, payment: 0 };
  const existing = { id: "order-local", number: "YO-26-0001", clientId: "client-1", sourceLinkMode: "MATCHED_EXISTING", sourceSystem: "KEYCRM", currency: "EUR", externalUpdatedAt: new Date("2026-10-01T00:00:00Z"), depositRequiredMinor: 5000, priceMinor: 10000, type: OrderType.CUSTOM_ORDER, paymentStatus: "UNPAID", productionStatus: "NOT_SCHEDULED" };
  const persisted = { ...existing, externalUpdatedAt: new Date("2026-10-02T00:00:00Z") };
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined,
    order: { findUnique: async () => existing, update: async () => persisted },
    clientMergeRedirect: { findUnique: async () => null },
    client: { findUniqueOrThrow: async () => ({ id: "client-1", email: null, phone: null, country: null, city: null, address: null, postalCode: null }) },
    orderItem: { count: async () => 1, findUnique: async () => null, upsert: async () => { writes.item++; }, create: async () => { writes.item++; } },
    payment: {
      findUnique: async () => null,
      findMany: async ({ where }) => where.sourceSystem === null ? [{ id: "p1" }, { id: "p2" }] : [],
      upsert: async () => { writes.payment++; }, update: async () => { writes.payment++; },
    },
    keycrmSyncIssue: { create: async ({ data }) => { issues.push(data); } },
    productionSlot: { findUnique: async () => null },
    shipment: { findUnique: async () => null },
    activity: { create: async () => undefined }, auditLog: { create: async () => undefined },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  const result = await service.importOrder(normalizedOrder({
    items: [{ externalId: "item-1", name: "Provider item", quantity: 1, priceMinor: 10000, notes: null, sku: null, externalImageUrl: null, properties: [] }],
    payments: [{ externalId: "pay-1", amountMinor: 5000, currency: "EUR", isPaid: true, receivedAt: new Date("2026-10-01T10:00:00Z"), method: "OTHER", reference: null, notes: null, externalStatus: "paid" }],
  }), "owner-1", "run-1");
  assert.equal(result, "UPDATED");
  assert.deepEqual(writes, { item: 0, payment: 0 });
  assert.deepEqual(issues.map(issue => issue.code), ["MATCHED_ORDER_ITEMS_PRESERVED", "AMBIGUOUS_EXISTING_PAYMENT"]);
});

test("отменённая оплата сохраняется уже при первом полном импорте", async () => {
  const KeycrmService = loadKeycrmService();
  let orderRow;
  let paymentRow;
  const activities = [];
  const audits = [];
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined,
    $queryRaw: async () => [],
    order: {
      findUnique: async ({ where }) => where.number ? null : orderRow || null,
      create: async ({ data }) => (orderRow = { id: "order-1", paymentStatus: "UNPAID", productionStatus: "NOT_SCHEDULED", ...data }),
      update: async ({ data }) => (orderRow = { ...orderRow, ...data }),
    },
    client: { create: async ({ data }) => ({ id: "client-1", ...data }) },
    orderItem: { count: async () => 0, create: async ({ data }) => ({ id: "item-1", ...data }) },
    payment: {
      findUnique: async () => paymentRow || null,
      findMany: async () => paymentRow ? [paymentRow] : [],
      create: async ({ data }) => (paymentRow = { id: "payment-1", ...data }),
    },
    productionSlot: { findUnique: async () => null },
    shipment: { findUnique: async () => null },
    activity: { create: async ({ data }) => { activities.push(data); } },
    auditLog: { create: async ({ data }) => { audits.push(data); } },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  const result = await service.importOrder(normalizedOrder({
    payments: [{ externalId: "pay-cancelled", amountMinor: 3000, currency: "EUR", isPaid: false, receivedAt: null, method: "OTHER", reference: null, notes: null, externalStatus: "cancelled" }],
  }), "owner-1", "run-1");
  assert.equal(result, "CREATED");
  assert.equal(paymentRow.externalStatus, "cancelled");
  assert.equal(typeof paymentRow.voidedAt?.toISOString, "function");
  assert.equal(paymentRow.receivedAt.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(activities.some(row => row.type === "PAYMENT_IMPORTED_VOIDED"), true);
  assert.equal(audits.some(row => row.entityType === "Payment" && row.action === "CREATE"), true);
});

test("повтор страницы после сбоя до checkpoint не дублирует импортированные сущности", async () => {
  const KeycrmService = loadKeycrmService();
  let orderRow;
  let itemRow;
  let paymentRow;
  const created = { orders: 0, items: 0, payments: 0, activities: 0, audits: 0 };
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined,
    $queryRaw: async () => [],
    order: {
      findUnique: async ({ where }) => where.number ? null : orderRow || null,
      create: async ({ data }) => { created.orders++; return (orderRow = { id: "order-1", paymentStatus: "UNPAID", productionStatus: "NOT_SCHEDULED", ...data }); },
      update: async ({ data }) => (orderRow = { ...orderRow, ...data }),
    },
    client: { create: async ({ data }) => ({ id: "client-1", ...data }) },
    orderItem: {
      count: async () => 0,
      findUnique: async () => itemRow || null,
      upsert: async ({ create, update }) => { if (itemRow) return (itemRow = { ...itemRow, ...update }); created.items++; return (itemRow = { id: "item-1", ...create }); },
    },
    payment: {
      findUnique: async () => paymentRow || null,
      findMany: async ({ where }) => where.sourceSystem === null ? [] : paymentRow && !paymentRow.voidedAt ? [paymentRow] : [],
      upsert: async ({ create, update }) => { if (paymentRow) return (paymentRow = { ...paymentRow, ...update }); created.payments++; return (paymentRow = { id: "payment-1", voidedAt: null, ...create }); },
      update: async ({ data }) => (paymentRow = { ...paymentRow, ...data }),
    },
    productionSlot: { findUnique: async () => null },
    shipment: { findUnique: async () => null },
    activity: { create: async () => { created.activities++; } },
    auditLog: { create: async () => { created.audits++; } },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  const order = normalizedOrder({
    items: [{ externalId: "item-1", name: "Leotard", quantity: 1, priceMinor: 10000, notes: null, sku: "SKU-1", externalImageUrl: null, properties: [] }],
    payments: [{ externalId: "pay-1", amountMinor: 10000, currency: "EUR", isPaid: true, receivedAt: new Date("2026-10-01T10:00:00Z"), method: "OTHER", reference: null, notes: null, externalStatus: "paid" }],
  });
  assert.equal(await service.importOrder(order, "owner-1", "run-1"), "CREATED");
  const afterFirstTransaction = { ...created };
  assert.equal(await service.importOrder(order, "owner-1", "run-1"), "SKIPPED");
  assert.deepEqual(created, afterFirstTransaction);
  assert.deepEqual({ orders: created.orders, items: created.items, payments: created.payments }, { orders: 1, items: 1, payments: 1 });
});
