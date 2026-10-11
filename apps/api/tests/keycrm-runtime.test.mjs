import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { OrderType } from "@prisma/client";
import ts from "typescript";
import { KeycrmClient } from "../src/keycrm/keycrm-client.ts";
import { hasUsableDeliveryAddress, matchedShippingCarrier, nextDepositRequired, normalizedPhoneDigits } from "../src/keycrm/keycrm-sync-policy.ts";
import { DEFAULT_PRODUCTION_DURATION_DAYS, DEFAULT_SHIPPING_LEAD_DAYS, productionSetting, productionWindow, subtractUtcDays } from "../src/orders/production-rules.ts";

const nativeRequire = createRequire(import.meta.url);

function loadKeycrmService(imageHooks = {}) {
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === "../prisma.service") return { PrismaService: class PrismaService {} };
    if (specifier === "../secret-box") return { decryptSecret: value => value, encryptSecret: value => value };
    if (specifier === "./keycrm-client") return { KeycrmClient: class KeycrmClient {}, KEYCRM_API_URL: "https://openapi.keycrm.app/v1" };
    if (specifier === "./keycrm-normalizer") return { normalizeKeycrmOrder: value => value };
    if (specifier === "./keycrm-image") return { materializeKeycrmOrderImage: imageHooks.materialize ?? (async () => "keycrm-test.jpg"), removeMaterializedKeycrmOrderImage: imageHooks.remove ?? (async () => true) };
    if (specifier === "./keycrm-sync-policy") return { hasUsableDeliveryAddress, matchedShippingCarrier, nextDepositRequired, normalizedPhoneDigits };
    if (specifier === "../orders/production-rules") return { DEFAULT_PRODUCTION_DURATION_DAYS, DEFAULT_SHIPPING_LEAD_DAYS, productionSetting, productionWindow, subtractUtcDays };
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

test("общий контакт нескольких клиентов без подходящего заказа не блокирует новый KeyCRM buyer", async () => {
  const KeycrmService = loadKeycrmService();
  const service = new KeycrmService({});
  service.findMatchingClientIds = async () => ["client-email", "client-chatwoot"];
  const db = {
    order: { findMany: async () => [] },
  };
  const order = normalizedOrder({ client: { ...normalizedOrder().client, keycrmBuyerId: 68, email: "shared@example.com" } });
  const match = await service.findPotentialMatch(db, order);
  assert.equal(match.order, null);
  assert.equal(match.ambiguous, false);
});

test("при нескольких клиентах единственный точный локальный заказ остаётся безопасным совпадением", async () => {
  const KeycrmService = loadKeycrmService();
  const service = new KeycrmService({});
  service.findMatchingClientIds = async () => ["client-email", "client-chatwoot"];
  const localOrder = { id: "order-local", number: "YO-26-0001", clientId: "client-chatwoot" };
  const db = {
    order: { findMany: async () => [localOrder] },
  };
  const match = await service.findPotentialMatch(db, normalizedOrder());
  assert.equal(match.ambiguous, false);
  assert.equal(match.order, localOrder);
});

test("несколько клиентов без точного заказа создают отдельную карточку для стабильного buyer ID", async () => {
  const KeycrmService = loadKeycrmService();
  const createdClients = [];
  const createdLinks = [];
  const tx = {
    $queryRaw: async () => [{ id: "client-email" }, { id: "client-chatwoot" }],
    client: {
      findMany: async () => [{ id: "client-email" }, { id: "client-chatwoot" }],
      create: async ({ data }) => { const row = { id: "client-keycrm-68", ...data }; createdClients.push(row); return row; },
      update: async () => { throw new Error("неоднозначный существующий клиент не должен изменяться"); },
    },
    keycrmClientLink: {
      findUnique: async () => null,
      create: async ({ data }) => { const row = { id: "link-68", ...data }; createdLinks.push(row); return row; },
    },
    auditLog: { create: async () => undefined },
  };
  const service = new KeycrmService({});
  const clientId = await service.resolveClient(tx, normalizedOrder({
    client: { ...normalizedOrder().client, keycrmBuyerId: 68, email: "shared@example.com", displayName: "KeyCRM Buyer", firstName: "KeyCRM Buyer" },
  }), "owner-1");
  assert.equal(clientId, "client-keycrm-68");
  assert.equal(createdClients.length, 1);
  assert.equal(createdLinks[0].keycrmBuyerId, 68);
  assert.equal(createdLinks[0].clientId, "client-keycrm-68");
});

test("неоднозначный контакт без стабильного buyer ID остаётся fail closed", async () => {
  const KeycrmService = loadKeycrmService();
  const tx = {
    $queryRaw: async () => [{ id: "client-email" }, { id: "client-chatwoot" }],
    client: { findMany: async () => [{ id: "client-email" }, { id: "client-chatwoot" }], create: async () => { throw new Error("client must not be created"); } },
  };
  const service = new KeycrmService({});
  await assert.rejects(() => service.resolveClient(tx, normalizedOrder({
    client: { ...normalizedOrder().client, keycrmBuyerId: null, email: "shared@example.com" },
  }), "owner-1"), /стабильный ID покупателя/);
});

test("поиск точного заказа не обрезается первыми тремя совпавшими клиентами", async () => {
  const KeycrmService = loadKeycrmService();
  const service = new KeycrmService({});
  service.findMatchingClientIds = async () => ["client-1", "client-2", "client-3", "client-4"];
  const localOrder = { id: "order-fourth", number: "YO-26-0042", clientId: "client-4" };
  const seen = [];
  const match = await service.findPotentialMatch({ order: { findMany: async ({ where }) => { seen.push(...where.clientId.in); return [localOrder]; } } }, normalizedOrder());
  assert.deepEqual(seen, ["client-1", "client-2", "client-3", "client-4"]);
  assert.equal(match.order, localOrder);
  assert.equal(match.ambiguous, false);
});

test("KeyCRM формирует кандидатов объединения по точному имени, email и телефону без раскрытия контактов", async () => {
  const KeycrmService = loadKeycrmService();
  const service = new KeycrmService({});
  const db = {
    $queryRaw: async () => [
      { id: "client-imported", displayName: "Buyer", email: "buyer@example.com", phone: "+38 (050) 123-45-67" },
      { id: "client-name", displayName: "@Buyer", email: null, phone: null },
      { id: "client-email", displayName: "Other", email: "BUYER@example.com", phone: null },
      { id: "client-phone", displayName: "Third", email: null, phone: "380501234567" },
    ],
  };
  const order = normalizedOrder({ client: { ...normalizedOrder().client, keycrmBuyerId: 68, displayName: "Buyer", email: "buyer@example.com", phone: "+380501234567" } });
  const candidates = await service.findClientMergeCandidates(db, order, "client-imported");
  assert.deepEqual(JSON.parse(JSON.stringify(candidates)), [
    { clientId: "client-name", displayName: "@Buyer", reasons: ["NAME"] },
    { clientId: "client-email", displayName: "Other", reasons: ["EMAIL"] },
    { clientId: "client-phone", displayName: "Third", reasons: ["PHONE"] },
  ]);
  assert.equal("email" in candidates[0], false);
  assert.equal("phone" in candidates[0], false);
});

test("предложение объединения дедуплицируется в рамках запуска и buyer ID", async () => {
  const KeycrmService = loadKeycrmService();
  const created = [];
  const prisma = {
    $queryRaw: async () => [{ id: "client-existing", displayName: "Buyer", email: "buyer@example.com", phone: null }],
    keycrmSyncIssue: {
      findFirst: async () => created[0] ?? null,
      create: async ({ data }) => { created.push(data); return data; },
    },
  };
  const service = new KeycrmService(prisma);
  const order = normalizedOrder({ client: { ...normalizedOrder().client, keycrmBuyerId: 68, displayName: "Buyer", email: "buyer@example.com" } });
  await service.recordClientMergeSuggestion(prisma, order, "run-1", null);
  await service.recordClientMergeSuggestion(prisma, { ...order, externalId: "order-2" }, "run-1", null);
  assert.equal(created.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(created[0].details)), {
    kind: "CLIENT_MERGE_SUGGESTION",
    dedupeKey: "BUYER:68",
    keycrmBuyerId: 68,
    importedClientId: null,
    candidates: [{ clientId: "client-existing", displayName: "Buyer", reasons: ["NAME", "EMAIL"] }],
  });
});

test("apply-предложение содержит импортированную карточку и исключает её из кандидатов", async () => {
  const KeycrmService = loadKeycrmService();
  const created = [];
  const prisma = {
    $queryRaw: async () => [
      { id: "client-imported", displayName: "Buyer", email: "buyer@example.com", phone: null },
      { id: "client-target", displayName: "Buyer", email: null, phone: null },
    ],
    keycrmSyncIssue: {
      findFirst: async () => null,
      create: async ({ data }) => { created.push(data); return data; },
    },
  };
  const service = new KeycrmService(prisma);
  const order = normalizedOrder({ client: { ...normalizedOrder().client, keycrmBuyerId: 68, displayName: "Buyer", email: "buyer@example.com" } });
  await service.recordClientMergeSuggestion(prisma, order, "run-apply", "client-imported");
  assert.equal(created[0].details.importedClientId, "client-imported");
  assert.deepEqual(JSON.parse(JSON.stringify(created[0].details.candidates)), [{ clientId: "client-target", displayName: "Buyer", reasons: ["NAME"] }]);
});

test("точное совпадение заказа получает структурированные details ORDER_MATCH", async () => {
  const KeycrmService = loadKeycrmService();
  const issues = [];
  const service = new KeycrmService({
    order: { findUnique: async () => null },
    keycrmSyncIssue: {
      findFirst: async () => null,
      create: async ({ data }) => { issues.push(data); return data; },
    },
    $queryRaw: async () => [],
  });
  service.findPotentialMatch = async () => ({ order: { id: "order-local", number: "YO-26-0042", clientId: "client-1" }, ambiguous: false });
  const result = await service.previewOrder(normalizedOrder(), "run-preview");
  assert.equal(result, "UPDATED");
  const matchIssue = issues.find(issue => issue.code === "MATCHED_EXISTING_ORDER");
  assert.deepEqual(JSON.parse(JSON.stringify(matchIssue.details)), {
    kind: "ORDER_MATCH",
    keycrmOrderId: "order-1",
    orderId: "order-local",
    orderNumber: "YO-26-0042",
    clientId: "client-1",
  });
});

test("первый импорт создаёт provider-owned производственный слот с deposit gate", async () => {
  const KeycrmService = loadKeycrmService();
  const created = [], audits = [], activities = [];
  const tx = {
    appSetting: { findMany: async () => [{ key: "shippingLeadDays", value: 2 }, { key: "defaultDurationDays", value: 7 }] },
    productionSlot: { findUnique: async () => null, create: async ({ data }) => { const row = { id: "slot-1", ...data }; created.push(row); return row; } },
    auditLog: { create: async ({ data }) => audits.push(data) }, activity: { create: async ({ data }) => activities.push(data) },
  };
  const service = new KeycrmService({});
  const persisted = { id: "order-1", clientId: "client-1", depositRequiredMinor: 5000, productionStatus: "NOT_SCHEDULED" };
  const order = normalizedOrder({ production: { startsAt: new Date("2026-09-20T00:00:00Z"), requiredDeliveryAt: new Date("2026-09-30T00:00:00Z") } });
  await service.syncProductionSlot(tx, order, persisted, 0, "owner-1", "run-1");
  assert.equal(created[0].startsAt.toISOString(), "2026-09-20T00:00:00.000Z");
  assert.equal(created[0].endsAt.toISOString(), "2026-09-28T00:00:00.000Z");
  assert.equal(created[0].tentative, true);
  assert.equal(created[0].sourceSystem, "KEYCRM");
  assert.equal(audits[0].action, "CREATE");
  assert.equal(activities[0].type, "KEYCRM_PRODUCTION_SLOT_SYNCED");
});

test("список замечаний не обрезает предложения объединения первыми 200 строками", async () => {
  const KeycrmService = loadKeycrmService();
  let query;
  const rows = Array.from({ length: 250 }, (_, index) => ({ id: `issue-${index}`, details: null }));
  const service = new KeycrmService({ keycrmSyncIssue: { findMany: async (args) => { query = args; return rows; } } });
  assert.equal((await service.issues("run-1")).length, 250);
  assert.equal("take" in query, false);
  assert.deepEqual(JSON.parse(JSON.stringify(query.orderBy)), [{ createdAt: "asc" }, { id: "asc" }]);
});

test("ручной или locked производственный слот не перезаписывается и создаёт issue", async () => {
  const KeycrmService = loadKeycrmService();
  for (const slot of [
    { id: "manual", sourceSystem: null, sourceAccount: null, externalId: null, locked: false },
    { id: "locked", sourceSystem: "KEYCRM", sourceAccount: "connection-1", externalId: "order-1", locked: true },
  ]) {
    const issues = [];
    const tx = {
      appSetting: { findMany: async () => [{ key: "shippingLeadDays", value: 2 }, { key: "defaultDurationDays", value: 7 }] },
      productionSlot: { findUnique: async () => slot, update: async () => { throw new Error("slot must stay unchanged"); } },
      keycrmSyncIssue: { create: async ({ data }) => issues.push(data) },
    };
    const service = new KeycrmService({});
    await service.syncProductionSlot(tx, normalizedOrder({ production: { startsAt: new Date("2026-09-20T00:00:00Z"), requiredDeliveryAt: new Date("2026-09-30T00:00:00Z") } }), { id: "order-1", clientId: "client-1", depositRequiredMinor: 5000 }, 0, "owner-1", "run-1");
    assert.equal(issues[0].code, "PRODUCTION_SLOT_PRESERVED");
  }
});

test("одно поле начала без подтверждённой конечной даты не создаёт слот", async () => {
  const KeycrmService = loadKeycrmService();
  const issues = [];
  const tx = { keycrmSyncIssue: { create: async ({ data }) => issues.push(data) } };
  const service = new KeycrmService({});
  await service.syncProductionSlot(tx, normalizedOrder({ production: { startsAt: new Date("2026-09-20T00:00:00Z"), requiredDeliveryAt: null } }), { id: "order-1", clientId: "client-1", depositRequiredMinor: 5000 }, 0, "owner-1", "run-1");
  assert.equal(issues[0].code, "INCOMPLETE_PRODUCTION_DATES");
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
  assert.equal(issues[0].code, "ORDER_CURRENCY_CHANGED");
});

test("preview и apply одинаково пропускают смену валюты связанного ручного заказа", async () => {
  const KeycrmService = loadKeycrmService();
  const issues = [];
  const existing = { id: "order-local", number: "YO-26-0001", sourceLinkMode: "MATCHED_EXISTING", currency: "EUR", externalUpdatedAt: new Date("2026-10-01T00:00:00Z") };
  const service = new KeycrmService({
    order: { findUnique: async () => existing },
    keycrmSyncIssue: { findFirst: async () => null, create: async ({ data }) => { issues.push(data); } },
    $queryRaw: async () => [],
  });
  const result = await service.previewOrder(normalizedOrder({ currency: "USD" }), "run-preview");
  assert.equal(result, "SKIPPED");
  assert.equal(issues[0].code, "ORDER_CURRENCY_CHANGED");
});

test("запоздавшая проверка подключения не перезаписывает новую ревизию настроек", async () => {
  const KeycrmService = loadKeycrmService();
  const values = new Map([["configRevision", 2], ["connectionStatus", "VERIFIED"]]);
  const writes = [];
  const tx = {
    $executeRaw: async () => undefined,
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
    $queryRaw: async () => [],
    order: { findUnique: async () => existing, update: async () => persisted },
    clientMergeRedirect: { findUnique: async () => null },
    client: { findUniqueOrThrow: async () => ({ id: "client-1", email: null, phone: null, country: null, city: null, address: null, postalCode: null }) },
    orderItem: { count: async () => 1, findUnique: async () => null, upsert: async () => { writes.item++; }, create: async () => { writes.item++; } },
    payment: {
      findUnique: async () => null,
      findMany: async ({ where }) => where.sourceSystem === null ? [{ id: "p1" }, { id: "p2" }] : [],
      upsert: async () => { writes.payment++; }, update: async () => { writes.payment++; },
    },
    keycrmSyncIssue: { findFirst: async () => null, create: async ({ data }) => { issues.push(data); } },
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

test("foreign-currency cancellation гасит существующую оплату, но не создаёт новую", async () => {
  const KeycrmService = loadKeycrmService();
  let orderRow = { id: "order-1", number: "KC-14", clientId: "client-1", sourceLinkMode: "IMPORTED", sourceSystem: "KEYCRM", currency: "EUR", externalUpdatedAt: new Date("2026-10-01T00:00:00Z"), depositRequiredMinor: 5000, priceMinor: 10000, type: OrderType.CUSTOM_ORDER, paymentStatus: "PARTIALLY_PAID", productionStatus: "NOT_SCHEDULED" };
  let paymentRow = { id: "payment-8", orderId: "order-1", sourceSystem: "KEYCRM", sourceAccount: "connection-1", externalId: "8", amountMinor: 5000, currency: "UAH", voidedAt: null };
  let creates = 0;
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined,
    $queryRaw: async () => [],
    order: { findUnique: async () => orderRow, update: async ({ data }) => (orderRow = { ...orderRow, ...data }) },
    clientMergeRedirect: { findUnique: async () => null },
    client: { findUniqueOrThrow: async () => ({ id: "client-1", email: null, phone: null, country: null, city: null, address: null, postalCode: null }) },
    keycrmClientLink: { findUnique: async () => null },
    orderItem: { count: async () => 0 },
    payment: {
      findUnique: async () => paymentRow,
      findMany: async () => paymentRow && !paymentRow.voidedAt ? [paymentRow] : [],
      create: async () => { creates++; throw new Error("foreign cancellation must not create a payment"); },
      update: async ({ data }) => (paymentRow = { ...paymentRow, ...data }),
    },
    productionSlot: { findUnique: async () => null }, shipment: { findUnique: async () => null },
    activity: { create: async () => undefined }, auditLog: { create: async () => undefined },
    keycrmSyncIssue: { findFirst: async () => null, create: async () => undefined },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  const result = await service.importOrder(normalizedOrder({
    externalId: "14",
    payments: [{ externalId: "8", amountMinor: 5000, currency: "UAH", isPaid: false, materializeIfMissing: false, receivedAt: null, method: "OTHER", reference: null, notes: null, externalStatus: "canceled" }],
  }), "owner-1", "run-1");
  assert.equal(result, "UPDATED");
  assert.equal(creates, 0);
  assert.equal(typeof paymentRow.voidedAt?.toISOString, "function");
  assert.equal(paymentRow.externalStatus, "canceled");
});

test("foreign-currency cancellation без прежней оплаты не материализуется", async () => {
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!previous && payment\.materializeIfMissing === false\) continue/);
});

test("rollback неудачного APPLY архивирует новый заказ и аннулирует provider payments", async () => {
  const removedImages = [];
  const KeycrmService = loadKeycrmService({ remove: async name => { removedImages.push(name); return true; } });
  const fingerprint = { id: "order-1", clientId: "client-1", number: "KC-77", modelImagePath: `keycrm-${"a".repeat(32)}.jpg`, items: [], payments: [], productionSlot: null, shipment: null, invoices: [], expenses: [], agreements: [] };
  const scope = { orderId: "order-1", clientIds: [], connectionKey: "connection-1", keycrmBuyerId: null };
  const persistedFingerprint = Object.fromEntries(Object.entries(fingerprint).reverse());
  const mutation = { id: "mutation-1", externalOrderId: "77", orderId: "order-1", kind: "IMPORTED_ORDER", beforeSnapshot: { scope: { ...scope, orderId: null }, order: null, clients: [], keycrmLinks: [] }, afterSnapshot: { keycrmLinks: [], clients: [], order: persistedFingerprint, scope: Object.fromEntries(Object.entries(scope).reverse()) }, rollbackEligible: true, rollbackBlockedReason: null, createdClientId: null, rolledBackAt: null };
  const run = { id: "run-1", mode: "APPLY", status: "FAILED", rolledBackAt: null, rollbackEligible: true, mutations: [mutation] };
  const writes = { paymentsVoided: false, orderArchived: false, mutationRolledBack: false, runRolledBack: false, audit: false };
  const tx = {
    $executeRaw: async () => undefined,
    $executeRawUnsafe: async () => undefined,
    keycrmSyncRun: {
      findUnique: async () => run,
      update: async ({ data }) => { Object.assign(run, data); writes.runRolledBack = Boolean(data.rolledBackAt); return run; },
    },
    order: {
      findUnique: async () => fingerprint,
      update: async ({ data }) => { writes.orderArchived = Boolean(data.archivedAt); },
      count: async () => 0,
    },
    orderItem: { updateMany: async () => undefined, count: async () => 0 },
    client: { findMany: async () => [] }, keycrmClientLink: { findMany: async () => [] },
    payment: { updateMany: async ({ data }) => { writes.paymentsVoided = Boolean(data.voidedAt && data.voidReason); } },
    activity: { create: async () => undefined },
    keycrmSyncMutation: { update: async ({ data }) => { writes.mutationRolledBack = Boolean(data.rolledBackAt); Object.assign(mutation, data); } },
    auditLog: { create: async () => { writes.audit = true; } },
  };
  let transactionOptions;
  const prisma = {
    $transaction: (callback, options) => { if (options) transactionOptions = options; return callback(tx); },
    keycrmSyncRun: { findUnique: async () => ({ ...run, startedBy: { id: "owner-1", displayName: "Owner" }, _count: { issues: 0 } }) },
  };
  const result = await new KeycrmService(prisma).rollback("run-1", { id: "owner-1" });
  assert.equal(Boolean(result.rolledBackAt), true);
  assert.deepEqual(writes, { paymentsVoided: true, orderArchived: true, mutationRolledBack: true, runRolledBack: true, audit: true });
  assert.deepEqual(removedImages, [`keycrm-${"a".repeat(32)}.jpg`]);
  assert.deepEqual(JSON.parse(JSON.stringify(transactionOptions)), { maxWait: 10_000, timeout: 120_000 });
});

test("rollback двух заказов одного покупателя восстанавливает общую карточку в обратном порядке", async () => {
  const KeycrmService = loadKeycrmService();
  const client0 = { id: "client-1", displayName: "До импорта" };
  const client1 = { id: "client-1", displayName: "После первого заказа" };
  const client2 = { id: "client-1", displayName: "После второго заказа" };
  const link0 = { id: "link-1", clientId: "client-1", connectionKey: "connection-1", keycrmBuyerId: "buyer-1", lastSyncedAt: "2026-10-11T10:00:00.000Z", rolledBackAt: null };
  const link1 = { ...link0, lastSyncedAt: "2026-10-11T10:01:00.000Z" };
  const link2 = { ...link0, lastSyncedAt: "2026-10-11T10:02:00.000Z" };
  const order1 = { id: "order-1", clientId: "client-1", number: "KC-1", items: [], payments: [], productionSlot: null, shipment: null, invoices: [], expenses: [], agreements: [] };
  const order2 = { id: "order-2", clientId: "client-1", number: "KC-2", items: [], payments: [], productionSlot: null, shipment: null, invoices: [], expenses: [], agreements: [] };
  const scope1 = { orderId: "order-1", clientIds: ["client-1"], connectionKey: "connection-1", keycrmBuyerId: "buyer-1" };
  const scope2 = { ...scope1, orderId: "order-2" };
  const mutation1 = { id: "m1", externalOrderId: "1", orderId: "order-1", kind: "IMPORTED_ORDER", beforeSnapshot: { scope: { ...scope1, orderId: null }, order: null, clients: [client0], keycrmLinks: [link0] }, afterSnapshot: { scope: scope1, order: order1, clients: [client1], keycrmLinks: [link1] }, rollbackEligible: true, rollbackBlockedReason: null, rolledBackAt: null };
  const mutation2 = { id: "m2", externalOrderId: "2", orderId: "order-2", kind: "IMPORTED_ORDER", beforeSnapshot: { scope: { ...scope2, orderId: null }, order: null, clients: [client1], keycrmLinks: [link1] }, afterSnapshot: { scope: scope2, order: order2, clients: [client2], keycrmLinks: [link2] }, rollbackEligible: true, rollbackBlockedReason: null, rolledBackAt: null };
  const unorderedMutations = [mutation1, mutation2];
  const run = { id: "run-1", mode: "APPLY", status: "PARTIAL", rolledBackAt: null, mutations: unorderedMutations };
  const state = { orders: new Map([["order-1", structuredClone(order1)], ["order-2", structuredClone(order2)]]), client: structuredClone(client2), link: structuredClone(link2), restored: [] };
  const tx = {
    $executeRaw: async () => undefined,
    $executeRawUnsafe: async () => undefined,
    keycrmSyncRun: { findUnique: async ({ include }) => {
      assert.equal(JSON.stringify(include.mutations.orderBy), JSON.stringify({ sequence: "desc" }));
      return { ...run, mutations: [mutation2, mutation1] };
    }, update: async ({ data }) => Object.assign(run, data) },
    order: { findUnique: async ({ where }) => structuredClone(state.orders.get(where.id)), update: async ({ where, data }) => { const row = { ...state.orders.get(where.id), ...data }; state.orders.set(where.id, row); return row; } },
    orderItem: { updateMany: async () => undefined },
    client: { findMany: async () => [structuredClone(state.client)], update: async ({ data }) => (state.client = { ...state.client, ...data }) },
    keycrmClientLink: { findMany: async () => [structuredClone(state.link)], update: async ({ data }) => (state.link = { ...state.link, ...data }) },
    payment: { updateMany: async () => undefined },
    activity: { create: async ({ data }) => state.restored.push(data.orderId) },
    keycrmSyncMutation: { update: async () => undefined },
    auditLog: { create: async () => undefined },
  };
  const prisma = { $transaction: callback => callback(tx), keycrmSyncRun: { findUnique: async () => ({ ...run, startedBy: { id: "owner-1", displayName: "Owner" }, _count: { issues: 0 } }) } };
  await new KeycrmService(prisma).rollback("run-1", { id: "owner-1" });
  assert.deepEqual(state.restored, ["order-2", "order-1"]);
  assert.equal(state.client.displayName, "До импорта");
  assert.equal(state.link.lastSyncedAt.toISOString(), "2026-10-11T10:00:00.000Z");
});

test("rollback использует те же глобальную, provider-order и order locks, что APPLY", () => {
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  const rollback = source.slice(source.indexOf("async rollback("), source.indexOf("async claimNextRun("));
  const apply = source.slice(source.indexOf("private async importOrder("), source.indexOf("private async resolveClient("));
  for (const fragment of ["client-merge-global", "SOURCE_SYSTEM}:${", "mutation.orderId"]) assert.match(rollback, new RegExp(fragment.replace(/[${}]/g, "\\$&")));
  for (const table of ["Order", "Client", "KeycrmClientLink"]) assert.match(rollback, new RegExp(`FROM \\\"${table}\\\"[\\s\\S]*FOR UPDATE`));
  assert.match(apply, /hashtext\(\$1\).*persisted\.id/s);
  assert.match(rollback, /orderBy: \{ sequence: "desc" \}/);
});

test("созданный импортом клиент не архивируется при появившейся AI или коммуникационной истории", async () => {
  const KeycrmService = loadKeycrmService();
  const delegates = ["order", "athlete", "conversation", "workTask", "customerMemory", "conversationFact", "agreement", "aiRun", "aiModeOverride", "aiRuntimeSetting", "messageDeliveryAttempt", "clientMergeRedirect", "clientMergeOperation"];
  for (const protectedDelegate of delegates) {
    const tx = Object.fromEntries(delegates.map((name) => [name, { count: async () => name === protectedDelegate ? 1 : 0 }]));
    assert.equal(await new KeycrmService({}).clientHasPostImportHistory(tx, "client-1", "order-1"), true);
  }
  const emptyTx = Object.fromEntries(delegates.map((name) => [name, { count: async () => 0 }]));
  assert.equal(await new KeycrmService({}).clientHasPostImportHistory(emptyTx, "client-1", "order-1"), false);
});

test("rollback snapshot охватывает клиента, provider link и поздние бизнес-сущности", () => {
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  const snapshot = source.slice(source.indexOf("private async rollbackSnapshot("), source.indexOf("private async attachBuyerToExistingClient("));
  for (const relation of ["invoices", "expenses", "agreements", "keycrmLinks", "client"]) assert.match(snapshot, new RegExp(relation));
  assert.match(source, /rollbackEligible/);
  assert.match(source, /rollbackBlockedReason/);
});

test("повторный APPLY после rollback явно реактивирует order и buyer link", () => {
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  assert.match(source, /externallyLinked && !externallyLinked\.archivedAt && !order\.externalUpdatedAt/);
  assert.match(source, /externallyLinked\?\.archivedAt \? \{ archivedAt: null \}/);
  assert.match(source, /linked && !linked\.rolledBackAt/);
  assert.match(source, /rolledBackAt: null/);
});

test("matched-existing rollback допускается только без необратимо созданных item, slot или shipment", () => {
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  const eligibility = source.slice(source.indexOf("function rollbackEligibility("), source.indexOf("const JSON_RESTORE_FIELDS"));
  assert.match(eligibility, /импорт создал новые \$\{label\}/);
  assert.match(eligibility, /импорт создал производственный слот/);
  assert.match(eligibility, /импорт создал доставку/);
  assert.match(eligibility, /eligible: true/);
});

test("rollback fail-closed блокирует позднее изменение снимка", async () => {
  const KeycrmService = loadKeycrmService();
  const makeService = (mutation, current) => new KeycrmService({
    $transaction: callback => callback({
      $executeRaw: async () => undefined,
      $executeRawUnsafe: async () => undefined,
      keycrmSyncRun: { findUnique: async () => ({ id: "run-1", mode: "APPLY", status: "PARTIAL", rolledBackAt: null, mutations: [mutation] }) },
      order: { findUnique: async () => current },
      client: { findMany: async () => [] }, keycrmClientLink: { findMany: async () => [] },
    }),
  });
  await assert.rejects(
    makeService({ id: "m2", externalOrderId: "2", orderId: "o2", kind: "IMPORTED_ORDER", afterSnapshot: { order: { id: "o2", value: "before" }, clients: [], keycrmLinks: [], scope: { orderId: "o2", clientIds: [], connectionKey: "c", keycrmBuyerId: null } }, rollbackEligible: true, rollbackBlockedReason: null, rolledBackAt: null }, { id: "o2", value: "after" }).rollback("run-1", { id: "owner-1" }),
    /изменён после импорта/,
  );
});

test("повтор страницы после сбоя до checkpoint не дублирует импортированные сущности", async () => {
  const KeycrmService = loadKeycrmService();
  let orderRow;
  let itemRow;
  let paymentRow;
  let slotRow;
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
    appSetting: { findMany: async () => [{ key: "shippingLeadDays", value: 2 }, { key: "defaultDurationDays", value: 7 }] },
    payment: {
      findUnique: async () => paymentRow || null,
      findMany: async ({ where }) => where.sourceSystem === null ? [] : paymentRow && !paymentRow.voidedAt ? [paymentRow] : [],
      upsert: async ({ create, update }) => { if (paymentRow) return (paymentRow = { ...paymentRow, ...update }); created.payments++; return (paymentRow = { id: "payment-1", voidedAt: null, ...create }); },
      update: async ({ data }) => (paymentRow = { ...paymentRow, ...data }),
    },
    productionSlot: {
      findUnique: async () => slotRow || null,
      create: async ({ data }) => (slotRow = { id: "slot-1", ...data }),
      update: async ({ data }) => (slotRow = { ...slotRow, ...data }),
    },
    shipment: { findUnique: async () => null },
    activity: { create: async () => { created.activities++; } },
    auditLog: { create: async () => { created.audits++; } },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  const order = normalizedOrder({
    production: { startsAt: new Date("2026-10-10T00:00:00Z"), requiredDeliveryAt: new Date("2026-10-20T00:00:00Z") },
    items: [{ externalId: "item-1", name: "Leotard", quantity: 1, priceMinor: 10000, notes: null, sku: "SKU-1", externalImageUrl: null, properties: [] }],
    payments: [{ externalId: "pay-1", amountMinor: 10000, currency: "EUR", isPaid: true, receivedAt: new Date("2026-10-01T10:00:00Z"), method: "OTHER", reference: null, notes: null, externalStatus: "paid" }],
  });
  assert.equal(await service.importOrder(order, "owner-1", "run-1"), "CREATED");
  assert.equal(slotRow.tentative, false);
  assert.equal(orderRow.productionStatus, "SCHEDULED");
  const afterFirstTransaction = { ...created };
  assert.equal(await service.importOrder(order, "owner-1", "run-1"), "SKIPPED");
  assert.deepEqual(created, afterFirstTransaction);
  assert.deepEqual({ orders: created.orders, items: created.items, payments: created.payments }, { orders: 1, items: 1, payments: 1 });
});

test("повторный sync восстанавливает главное изображение неизменённого заказа после временной ошибки", async () => {
  let attempts = 0;
  const imageName = `keycrm-${"b".repeat(32)}.jpg`;
  const KeycrmService = loadKeycrmService({ materialize: async () => { attempts++; if (attempts === 1) throw new Error("TEMPORARY"); return imageName; } });
  let orderRow;
  let itemRow;
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined, $queryRaw: async () => [],
    order: {
      findUnique: async ({ where }) => where.number ? null : orderRow || null,
      create: async ({ data }) => (orderRow = { id: "order-image", paymentStatus: "UNPAID", productionStatus: "NOT_SCHEDULED", ...data }),
      update: async ({ data }) => (orderRow = { ...orderRow, ...data }),
    },
    client: { create: async ({ data }) => ({ id: "client-image", ...data }), findUniqueOrThrow: async () => ({ id: "client-image", email: null, phone: null, country: null, city: null, address: null, postalCode: null }) },
    clientMergeRedirect: { findUnique: async () => null }, keycrmClientLink: { findUnique: async () => null },
    orderItem: {
      count: async () => 0,
      findUnique: async () => itemRow || null,
      upsert: async ({ create, update }) => itemRow ? (itemRow = { ...itemRow, ...update }) : (itemRow = { id: "item-image", ...create }),
    },
    payment: { findUnique: async () => null, findMany: async () => [] }, productionSlot: { findUnique: async () => null }, shipment: { findUnique: async () => null },
    activity: { create: async () => undefined }, auditLog: { create: async () => undefined }, keycrmSyncIssue: { findFirst: async () => null, create: async () => undefined },
  };
  const prisma = { $transaction: callback => callback(tx), keycrmSyncIssue: { create: async () => undefined } };
  const service = new KeycrmService(prisma);
  const order = normalizedOrder({ items: [{ externalId: "item-image", name: "Leotard", quantity: 1, priceMinor: 10000, notes: null, sku: null, externalImageUrl: "https://cdn.example.test/order.jpg", properties: [] }] });
  assert.equal(await service.importOrder(order, "owner-1", "run-1"), "CREATED");
  assert.equal(orderRow.modelImagePath, undefined);
  assert.equal(await service.importOrder(order, "owner-1", "run-2"), "UPDATED");
  assert.equal(orderRow.modelImagePath, imageName);
  assert.equal(itemRow.modelImagePath, imageName);
});

test("материализованный файл очищается после SKIPPED и ошибки транзакции", async () => {
  const removed = [];
  const imageName = `keycrm-${"c".repeat(32)}.jpg`;
  const KeycrmService = loadKeycrmService({ materialize: async () => imageName, remove: async (name) => { removed.push(name); return true; } });
  const order = normalizedOrder({ externalUpdatedAt: null, items: [{ externalId: "item-image", name: "Leotard", quantity: 1, priceMinor: 10000, notes: null, sku: null, externalImageUrl: "https://cdn.example.test/order.jpg", properties: [] }] });
  const cleanupTx = { $executeRawUnsafe: async () => undefined, order: { count: async () => 0 }, orderItem: { count: async () => 0 } };
  let calls = 0;
  const skippedTx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined,
    order: { findUnique: async () => ({ id: "order-1", archivedAt: null, modelImagePath: "manual.jpg", externalUpdatedAt: null }) },
  };
  const skipped = new KeycrmService({ $transaction: callback => callback(++calls === 1 ? skippedTx : cleanupTx) });
  assert.equal(await skipped.importOrder(order, "owner-1", "run-1"), "SKIPPED");
  assert.deepEqual(removed, [imageName]);

  calls = 0;
  const failed = new KeycrmService({ $transaction: callback => { calls++; if (calls === 1) throw new Error("DB_FAILED"); return callback(cleanupTx); } });
  await assert.rejects(() => failed.importOrder(order, "owner-1", "run-2"), /DB_FAILED/);
  assert.deepEqual(removed, [imageName, imageName]);
});

test("общий импортированный файл не удаляется, пока на него ссылается заказ или позиция", async () => {
  for (const [orders, items] of [[1, 0], [0, 1]]) {
    const removed = [];
    const imageName = `keycrm-${"d".repeat(32)}.jpg`;
    const KeycrmService = loadKeycrmService({ remove: async (name) => { removed.push(name); return true; } });
    const tx = {
      $executeRawUnsafe: async () => undefined,
      order: { count: async () => orders },
      orderItem: { count: async () => items },
    };
    await new KeycrmService({ $transaction: callback => callback(tx) }).cleanupImportedImage(imageName);
    assert.deepEqual(removed, [], `orders=${orders}, items=${items}`);
  }
});
