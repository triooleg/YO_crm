import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { OrderType, Prisma } from "@prisma/client";
import ts from "typescript";
import { loadTargetModule } from "./overview-target-loader.mjs";
import { KeycrmClient } from "../src/keycrm/keycrm-client.ts";
import {
  hasUsableDeliveryAddress,
  keycrmCostumeCount,
  keycrmProductionDurationDays,
  matchedShippingCarrier,
  nextDepositRequired,
  normalizedPhoneDigits,
} from "../src/keycrm/keycrm-sync-policy.ts";
import { DEFAULT_PRODUCTION_DURATION_DAYS, DEFAULT_SHIPPING_LEAD_DAYS, productionSetting, productionWindow, requiresProduction, subtractUtcDays } from "../src/orders/production-rules.ts";
import { keycrmShipmentWriteMode, keycrmShippingFinanceWrite, selectKeycrmProviderShipment } from "../src/keycrm/keycrm-shipment-policy.ts";

const nativeRequire = createRequire(import.meta.url);

function loadKeycrmService(imageHooks = {}) {
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === "./website-checkout-correlation") return loadTargetModule("keycrm/website-checkout-correlation.ts");
    if (specifier === "../website-orders/website-order-number") return { nextOrderNumber: imageHooks.nextOrderNumber ?? (async () => "YO-900000001") };
    if (specifier === "../prisma.service") return { PrismaService: class PrismaService {} };
    if (specifier === "../secret-box") return { decryptSecret: value => value, encryptSecret: value => value };
    if (specifier === "./keycrm-client") return { KeycrmClient: class KeycrmClient {}, KEYCRM_API_URL: "https://openapi.keycrm.app/v1" };
    if (specifier === "./keycrm-normalizer") return { normalizeKeycrmOrder: value => value };
    if (specifier === "./keycrm-image") return { materializeKeycrmOrderImage: imageHooks.materialize ?? (async () => "keycrm-test.jpg"), removeMaterializedKeycrmOrderImage: imageHooks.remove ?? (async () => true) };
    if (specifier === "./keycrm-sync-policy") return { hasUsableDeliveryAddress, keycrmCostumeCount, keycrmProductionDurationDays, matchedShippingCarrier, nextDepositRequired, normalizedPhoneDigits };
    if (specifier === "./keycrm-shipment-policy") return { keycrmShipmentWriteMode, keycrmShippingFinanceWrite, selectKeycrmProviderShipment };
    if (specifier === "../orders/production-rules") return { DEFAULT_PRODUCTION_DURATION_DAYS, DEFAULT_SHIPPING_LEAD_DAYS, productionSetting, productionWindow, requiresProduction, subtractUtcDays };
    if (specifier === "../orders/production-status-graph") return { updateProductionStatusGraph: async (tx, orderId, nextStatus, orderData = {}) => {
      const order = await tx.order.update({ where: { id: orderId }, data: { ...orderData, productionStatus: nextStatus } });
      await tx.orderItem?.updateMany?.({ where: { orderId }, data: { productionStatus: nextStatus } });
      await tx.orderItemInstance?.updateMany?.({ where: { orderItem: { orderId }, archivedAt: null }, data: { productionStatus: nextStatus } });
      return order;
    } };
    if (specifier === "../orders/order-item-details") return { reconcileOrderItemInstances: imageHooks.reconcileOrderItemInstances ?? (async (tx, item, quantity) => {
      if (!tx.orderItemInstance) return;
      const existing = await tx.orderItemInstance.findMany({ where: { orderItemId: item.id } });
      for (let ordinal = 1; ordinal <= quantity; ordinal += 1) if (!existing.some(instance => instance.ordinal === ordinal && !instance.archivedAt)) {
        await tx.orderItemInstance.create({ data: { orderItemId: item.id, ordinal, athleteId: item.athleteId ?? null, measurementId: item.measurementId ?? null, productionStatus: item.productionStatus } });
      }
    }) };
    if (specifier === "../finance/exchange-rates") return { appliedPaymentMinor: (payment, orderCurrency) => payment.currency === orderCurrency ? payment.amountMinor : payment.appliedCurrency === orderCurrency ? payment.appliedAmountMinor ?? 0 : 0 };
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

test("KeyCRM не создаёт производственный слот для быстрой продажи", async () => {
  const KeycrmService = loadKeycrmService();
  let reads = 0;
  const tx = {
    productionSlot: {
      findUnique: async () => { reads++; return null; },
      create: async () => { throw new Error("SLOT_MUST_NOT_BE_CREATED"); },
      update: async () => { throw new Error("SLOT_MUST_NOT_BE_UPDATED"); },
    },
    keycrmSyncIssue: { create: async () => undefined },
    activity: { create: async () => undefined },
    auditLog: { create: async () => undefined },
  };
  const order = normalizedOrder({
    type: OrderType.CUSTOM_ORDER,
    production: { startsAt: new Date("2026-10-10T00:00:00Z"), requiredDeliveryAt: new Date("2026-10-20T00:00:00Z") },
  });
  assert.equal(await new KeycrmService({}).syncProductionSlot(tx, order, { id: "ready-1", clientId: "client-1", depositRequiredMinor: 0, type: OrderType.READY_MODEL }, 10000, "owner-1", "run-1"), null);
  assert.equal(reads, 0);
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

test("повторный импорт активирует каждого покупателя, указанного в заказе", async () => {
  const KeycrmService = loadKeycrmService();
  const archivedAt = new Date("2026-10-10T10:00:00.000Z");
  const clientUpdates = [];
  const linkUpdates = [];
  const audits = [];
  const linkedClient = {
    id: "client-keycrm-68", archivedAt, email: null, phone: null, country: null,
    city: null, address: null, postalCode: null,
  };
  const tx = {
    clientMergeRedirect: { findUnique: async () => null },
    client: {
      update: async ({ data }) => { clientUpdates.push(data); return { ...linkedClient, ...data }; },
      findUniqueOrThrow: async () => linkedClient,
    },
    keycrmClientLink: {
      findUnique: async () => ({
        id: "link-68", clientId: linkedClient.id, connectionKey: "connection-1",
        keycrmBuyerId: 68, rolledBackAt: archivedAt, client: linkedClient,
      }),
      update: async ({ data }) => { linkUpdates.push(data); return { id: "link-68", ...data }; },
    },
    auditLog: { create: async ({ data }) => { audits.push(data); } },
  };

  const clientId = await new KeycrmService({}).resolveClient(tx, normalizedOrder({
    client: { ...normalizedOrder().client, keycrmBuyerId: 68, email: "buyer@example.com" },
  }), "owner-1");

  assert.equal(clientId, linkedClient.id);
  assert.equal(clientUpdates.length, 1);
  assert.equal(clientUpdates[0].archivedAt, null);
  assert.equal(clientUpdates[0].email, "buyer@example.com");
  assert.equal(linkUpdates[0].rolledBackAt, null);
  assert.deepEqual(audits.map(item => item.entityType), ["Client", "KeycrmClientLink"]);
});

test("rollback-снимок включает исходного и канонического клиента объединённой карточки", async () => {
  const KeycrmService = loadKeycrmService();
  const service = new KeycrmService({});
  const tx = { clientMergeRedirect: { findUnique: async ({ where }) => where.sourceClientId === "source" ? { targetClientId: "target" } : null } };
  assert.deepEqual(JSON.parse(JSON.stringify(await service.rollbackClientIds(tx, ["source", "direct"]))), ["direct", "source", "target"]);
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
  assert.equal(created[0].endsAt.toISOString(), "2026-09-27T00:00:00.000Z");
  assert.equal(created[0].tentative, true);
  assert.equal(created[0].sourceSystem, "KEYCRM");
  assert.equal(audits[0].action, "CREATE");
  assert.equal(activities[0].type, "KEYCRM_PRODUCTION_SLOT_SYNCED");
});

test("длительность производства KeyCRM зависит от общего количества костюмов", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(keycrmProductionDurationDays),
    [6, 8, 11, 14, 17],
  );
  assert.equal(keycrmCostumeCount([{ quantity: 2 }, { quantity: 2 }]), 4);
  assert.equal(keycrmCostumeCount([]), 0);
});

test("при пустом начале производства слот рассчитывается от даты отправки и количества костюмов", async () => {
  const KeycrmService = loadKeycrmService();
  const created = [];
  const tx = {
    productionSlot: { findUnique: async () => null, create: async ({ data }) => { const row = { id: "slot-calculated", ...data }; created.push(row); return row; } },
    auditLog: { create: async () => undefined },
    activity: { create: async () => undefined },
  };
  const service = new KeycrmService({});
  const order = normalizedOrder({
    production: { startsAt: null, requiredDeliveryAt: new Date("2027-01-18T00:00:00Z") },
    items: [
      { externalId: "item-1", name: "Leotard A", quantity: 2, priceMinor: 10000, notes: null, sku: null, externalImageUrl: null, properties: [] },
      { externalId: "item-2", name: "Leotard B", quantity: 1, priceMinor: 10000, notes: null, sku: null, externalImageUrl: null, properties: [] },
    ],
  });
  await service.syncProductionSlot(tx, order, { id: "order-1", clientId: "client-1", depositRequiredMinor: 5000 }, 0, "owner-1", "run-1");
  assert.equal(created[0].endsAt.toISOString(), "2027-01-15T00:00:00.000Z");
  assert.equal(created[0].startsAt.toISOString(), "2027-01-04T00:00:00.000Z");
});

test("повторная синхронизация пересчитывает только существующий provider-owned слот без дубля", async () => {
  const KeycrmService = loadKeycrmService();
  let current = {
    id: "slot-existing",
    orderId: "order-1",
    startsAt: new Date("2027-01-01T00:00:00Z"),
    endsAt: new Date("2027-01-02T00:00:00Z"),
    capacity: 4,
    tentative: false,
    locked: false,
    sourceSystem: "KEYCRM",
    sourceAccount: "connection-1",
    externalId: "order-1",
  };
  const updates = [], audits = [], activities = [];
  const tx = {
    productionSlot: {
      findUnique: async () => current,
      create: async () => { throw new Error("existing slot must not be duplicated"); },
      update: async ({ data }) => {
        updates.push(data);
        current = { ...current, ...data };
        return current;
      },
    },
    auditLog: { create: async ({ data }) => audits.push(data) },
    activity: { create: async ({ data }) => activities.push(data) },
  };
  const service = new KeycrmService({});
  const imported = (quantity) => normalizedOrder({
    production: { startsAt: null, requiredDeliveryAt: new Date("2027-01-18T00:00:00Z") },
    items: [{ externalId: "item-1", name: "Leotard", quantity, priceMinor: 10000, notes: null, sku: null, externalImageUrl: null, properties: [] }],
  });

  await service.syncProductionSlot(tx, imported(2), { id: "order-1", clientId: "client-1", depositRequiredMinor: 5000 }, 5000, "owner-1", "run-1");
  await service.syncProductionSlot(tx, imported(2), { id: "order-1", clientId: "client-1", depositRequiredMinor: 5000 }, 5000, "owner-1", "run-1");
  await service.syncProductionSlot(tx, imported(3), { id: "order-1", clientId: "client-1", depositRequiredMinor: 5000 }, 5000, "owner-1", "run-1");

  assert.equal(updates.length, 3);
  assert.equal(updates[0].startsAt.toISOString(), "2027-01-07T00:00:00.000Z");
  assert.equal(updates[1].startsAt.toISOString(), "2027-01-07T00:00:00.000Z");
  assert.equal(updates[2].startsAt.toISOString(), "2027-01-04T00:00:00.000Z");
  assert.equal(current.endsAt.toISOString(), "2027-01-15T00:00:00.000Z");
  assert.equal(current.capacity, 4);
  assert.equal(current.tentative, false);
  assert.deepEqual(audits.map((entry) => entry.action), ["UPDATE", "UPDATE", "UPDATE"]);
  assert.equal(activities.length, 3);
});

test("заказ KeyCRM без товаров не получает вычисленный производственный слот", async () => {
  const KeycrmService = loadKeycrmService();
  const issues = [];
  const tx = {
    productionSlot: { findUnique: async () => null, create: async () => { throw new Error("slot must not be created"); } },
    keycrmSyncIssue: { create: async ({ data }) => issues.push(data) },
  };
  const service = new KeycrmService({});
  await service.syncProductionSlot(
    tx,
    normalizedOrder({ production: { startsAt: null, requiredDeliveryAt: new Date("2027-01-18T00:00:00Z") }, items: [] }),
    { id: "order-1", clientId: "client-1", depositRequiredMinor: 5000 },
    0,
    "owner-1",
    "run-1",
  );
  assert.equal(issues[0].code, "MISSING_PRODUCTION_ITEMS");
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

test("ручной, locked или принадлежащий другому provider scope слот не перезаписывается", async () => {
  const KeycrmService = loadKeycrmService();
  for (const slot of [
    { id: "manual", sourceSystem: null, sourceAccount: null, externalId: null, locked: false },
    { id: "other-source", sourceSystem: "OTHER", sourceAccount: "connection-1", externalId: "order-1", locked: false },
    { id: "other-account", sourceSystem: "KEYCRM", sourceAccount: "connection-2", externalId: "order-1", locked: false },
    { id: "other-order", sourceSystem: "KEYCRM", sourceAccount: "connection-1", externalId: "order-2", locked: false },
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

test("фактическая дата отправки KeyCRM сохраняется в Shipment без перезаписи ручной даты", async () => {
  const KeycrmService = loadKeycrmService();
  let orderRow;
  let shipmentRow;
  const audits = [];
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined, $queryRaw: async () => [],
    order: {
      findUnique: async ({ where }) => where.number ? null : orderRow || null,
      create: async ({ data }) => (orderRow = { id: "order-1", paymentStatus: "UNPAID", productionStatus: "NOT_SCHEDULED", ...data }),
      update: async ({ data }) => (orderRow = { ...orderRow, ...data }),
    },
    client: { create: async ({ data }) => ({ id: "client-1", ...data }) },
    orderItem: { count: async () => 0, create: async ({ data }) => ({ id: "item-1", ...data }) },
    payment: { findUnique: async () => null, findMany: async () => [] },
    productionSlot: { findUnique: async () => null },
    shipment: {
      findUnique: async () => shipmentRow || null,
      create: async ({ data }) => (shipmentRow = { id: "shipment-1", ...data }),
      update: async ({ data }) => (shipmentRow = { ...shipmentRow, ...data }),
    },
    activity: { create: async () => undefined },
    auditLog: { create: async ({ data }) => { audits.push(data); } },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  const shippedAt = new Date("2026-10-06T08:00:00.000Z");
  await service.importOrder(normalizedOrder({
    delivery: { addressLine1: null, addressLine2: null, city: null, region: null, postalCode: null, addressText: null, serviceId: "nova-1", serviceName: "Nova Poshta", trackingCode: "TRACK-1", externalStatus: "sent", shippedAt },
  }), "owner-1", "run-1");
  assert.equal(shipmentRow.shippedAt.toISOString(), shippedAt.toISOString());
  assert.equal(audits.some(row => row.entityType === "Shipment" && row.action === "CREATE"), true);

  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  assert.match(source, /else if \(!shipment\.shippedAt && order\.delivery\.shippedAt\)/);
  assert.doesNotMatch(source, /else if \(shipment\.shippedAt && order\.delivery\.shippedAt\)/);
});

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
  let orderUpdateData;
  const existing = { id: "order-local", number: "YO-26-0001", clientId: "client-1", sourceLinkMode: "MATCHED_EXISTING", sourceSystem: "KEYCRM", currency: "EUR", externalUpdatedAt: new Date("2026-10-01T00:00:00Z"), depositRequiredMinor: 5000, priceMinor: 10000, type: OrderType.CUSTOM_ORDER, paymentStatus: "UNPAID", productionStatus: "NOT_SCHEDULED" };
  const refreshedExisting = { ...existing, depositRequiredMinor: 5500, priceMinor: 11000, modelImagePath: "manual-after-discovery.jpg" };
  const persisted = { ...refreshedExisting, externalUpdatedAt: new Date("2026-10-02T00:00:00Z") };
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined,
    $queryRaw: async () => [],
    order: { findUnique: async ({ where }) => where.id ? refreshedExisting : existing, update: async ({ data }) => { orderUpdateData = data; return persisted; } },
    clientMergeRedirect: { findUnique: async () => null },
    client: { findUniqueOrThrow: async () => ({ id: "client-1", email: null, phone: null, country: null, city: null, address: null, postalCode: null }) },
    orderItem: { count: async () => 1, findUnique: async () => null, upsert: async () => { writes.item++; }, create: async () => { writes.item++; } },
    orderItemInstance: { findMany: async () => [], create: async () => undefined },
    payment: {
      findUnique: async () => null,
      findMany: async ({ where }) => where.sourceSystem === null ? [{ id: "p1" }, { id: "p2" }] : [],
      upsert: async () => { writes.payment++; }, update: async () => { writes.payment++; },
    },
    keycrmSyncIssue: { findFirst: async () => null, create: async ({ data }) => { issues.push(data); } },
    productionSlot: { findUnique: async () => null },
    shipment: { findUnique: async () => null },
    activity: { findFirst: async () => ({ id: "manual-price-change" }), create: async () => undefined }, auditLog: { create: async () => undefined },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  const result = await service.importOrder(normalizedOrder({
    priceMinor: 12000,
    items: [{ externalId: "item-1", name: "Provider item", quantity: 1, priceMinor: 10000, notes: null, sku: null, externalImageUrl: "https://cdn.example.test/provider-new.jpg", properties: [] }],
    payments: [{ externalId: "pay-1", amountMinor: 5000, currency: "EUR", isPaid: true, receivedAt: new Date("2026-10-01T10:00:00Z"), method: "OTHER", reference: null, notes: null, externalStatus: "paid" }],
  }), "owner-1", "run-1");
  assert.equal(result, "UPDATED");
  assert.equal(orderUpdateData.priceMinor, 11000);
  assert.equal(orderUpdateData.depositRequiredMinor, 5500);
  assert.equal(orderUpdateData.modelImagePath, undefined);
  assert.deepEqual(writes, { item: 0, payment: 0 });
  assert.deepEqual(issues.map(issue => issue.code), ["MATCHED_ORDER_ITEMS_PRESERVED", "AMBIGUOUS_EXISTING_PAYMENT"]);
});

test("отменённая оплата сохраняется уже при первом полном импорте", async () => {
  const KeycrmService = loadKeycrmService();
  let orderRow;
  let paymentRow;
  const activities = [];
  const audits = [];
  const taxHooks=[];
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
  const service = new KeycrmService({ $transaction: callback => callback(tx) }, {capturePayment:async(...args)=>taxHooks.push(args)});
  const result = await service.importOrder(normalizedOrder({
    payments: [{ externalId: "pay-cancelled", amountMinor: 3000, currency: "EUR", isPaid: false, receivedAt: null, method: "OTHER", reference: null, notes: null, externalStatus: "cancelled" }],
  }), "owner-1", "run-1");
  assert.equal(result, "CREATED");
  assert.equal(paymentRow.externalStatus, "cancelled");
  assert.equal(typeof paymentRow.voidedAt?.toISOString, "function");
  assert.equal(paymentRow.receivedAt.toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(activities.some(row => row.type === "PAYMENT_IMPORTED_VOIDED"), true);
  assert.equal(audits.some(row => row.entityType === "Payment" && row.action === "CREATE"), true);
  assert.equal(taxHooks.length,0);
});

test("foreign-currency cancellation гасит существующую оплату, но не создаёт новую", async () => {
  const KeycrmService = loadKeycrmService();
  let orderRow = { id: "order-1", number: "KC-14", clientId: "client-1", sourceLinkMode: "IMPORTED", sourceSystem: "KEYCRM", currency: "EUR", externalUpdatedAt: new Date("2026-10-01T00:00:00Z"), depositRequiredMinor: 5000, priceMinor: 10000, type: OrderType.CUSTOM_ORDER, paymentStatus: "PARTIALLY_PAID", productionStatus: "NOT_SCHEDULED" };
  let paymentRow = { id: "payment-8", orderId: "order-1", sourceSystem: "KEYCRM", sourceAccount: "connection-1", externalId: "8", amountMinor: 5000, currency: "UAH", voidedAt: null };
  let creates = 0;
  const taxHooks=[];
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined,
    $queryRaw: async () => [],
    order: { findUnique: async () => orderRow, update: async ({ data }) => (orderRow = { ...orderRow, ...data }) },
    clientMergeRedirect: { findUnique: async () => null },
    client: { findUniqueOrThrow: async () => ({ id: "client-1", email: null, phone: null, country: null, city: null, address: null, postalCode: null }) },
    keycrmClientLink: { findUnique: async () => null },
    orderItem: { count: async () => 0 },
    orderItemInstance: { findMany: async () => [] },
    payment: {
      findUnique: async () => paymentRow,
      findMany: async () => paymentRow && !paymentRow.voidedAt ? [paymentRow] : [],
      create: async () => { creates++; throw new Error("foreign cancellation must not create a payment"); },
      update: async ({ data }) => (paymentRow = { ...paymentRow, ...data }),
    },
    productionSlot: { findUnique: async () => null }, shipment: { findUnique: async () => null },
    activity: { findFirst: async () => null, create: async () => undefined }, auditLog: { create: async () => undefined },
    keycrmSyncIssue: { findFirst: async () => null, create: async () => undefined },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) }, {capturePayment:async(...args)=>taxHooks.push(args)});
  const result = await service.importOrder(normalizedOrder({
    externalId: "14",
    payments: [{ externalId: "8", amountMinor: 5000, currency: "UAH", isPaid: false, materializeIfMissing: false, receivedAt: null, method: "OTHER", reference: null, notes: null, externalStatus: "canceled" }],
  }), "owner-1", "run-1");
  assert.equal(result, "UPDATED");
  assert.equal(creates, 0);
  assert.equal(typeof paymentRow.voidedAt?.toISOString, "function");
  assert.equal(paymentRow.externalStatus, "canceled");
  assert.equal(taxHooks.length,1);assert.equal(taxHooks[0][0],tx);assert.equal(taxHooks[0][1],paymentRow.id);assert.equal(taxHooks[0][2],"IMPORT_VOID");assert.ok(paymentRow.voidedAt);
});

test("foreign-currency cancellation без прежней оплаты не материализуется", async () => {
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  assert.match(source, /if \(!previous && payment\.materializeIfMissing === false\) continue/);
});

test("rollback неудачного APPLY архивирует новый заказ и аннулирует provider payments", async () => {
  const removedImages = [];
  const KeycrmService = loadKeycrmService({ remove: async name => { removedImages.push(name); return true; } });
  const fingerprint = { id: "order-1", clientId: "client-1", number: "KC-77", modelImagePath: `keycrm-${"a".repeat(32)}.jpg`, items: [{ id: "item-1" }], payments: [], productionSlot: null, shipment: null, invoices: [], expenses: [], agreements: [] };
  const instance = { id: "instance-1", orderItemId: "item-1", ordinal: 1, archivedAt: null };
  const scope = { orderId: "order-1", clientIds: [], connectionKey: "connection-1", keycrmBuyerId: null };
  const persistedFingerprint = Object.fromEntries(Object.entries(fingerprint).reverse());
  const mutation = { id: "mutation-1", externalOrderId: "77", orderId: "order-1", kind: "IMPORTED_ORDER", beforeSnapshot: { version: 2, scope: { ...scope, orderId: null }, order: null, orderItemInstances: [], orderShipments: [], clients: [], keycrmLinks: [] }, afterSnapshot: { version: 2, keycrmLinks: [], clients: [], orderItemInstances: [instance], orderShipments: [], order: persistedFingerprint, scope: Object.fromEntries(Object.entries(scope).reverse()) }, rollbackEligible: true, rollbackBlockedReason: null, createdClientId: null, rolledBackAt: null };
  const run = { id: "run-1", mode: "APPLY", status: "FAILED", rolledBackAt: null, rollbackEligible: true, mutations: [mutation] };
  const writes = { paymentsVoided: false, instancesArchived: false, orderArchived: false, mutationRolledBack: false, runRolledBack: false, audit: false };
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
    orderItemInstance: { findMany: async () => [instance], updateMany: async ({ data }) => { writes.instancesArchived = Boolean(data.archivedAt); } },
    client: { findMany: async () => [] }, keycrmClientLink: { findMany: async () => [] },
    payment: { findMany: async () => [{id:"unchanged-manual"},{id:"provider-voided"}], updateMany: async ({ data }) => { writes.paymentsVoided = Boolean(data.voidedAt && data.voidReason); } },
    activity: { create: async () => undefined },
    keycrmSyncMutation: { update: async ({ data }) => { writes.mutationRolledBack = Boolean(data.rolledBackAt); Object.assign(mutation, data); } },
    auditLog: { create: async () => { writes.audit = true; } },
  };
  let transactionOptions;
  const prisma = {
    $transaction: (callback, options) => { if (options) transactionOptions = options; return callback(tx); },
    keycrmSyncRun: { findUnique: async () => ({ ...run, startedBy: { id: "owner-1", displayName: "Owner" }, _count: { issues: 0 } }) },
  };
  const taxHooks=[];
  const result = await new KeycrmService(prisma,{capturePayment:async(...args)=>taxHooks.push(args)}).rollback("run-1", { id: "owner-1" });
  assert.equal(Boolean(result.rolledBackAt), true);
  assert.deepEqual(taxHooks.map(x=>[x[1],x[4].createIfMissing]),[["unchanged-manual",false],["provider-voided",false]]);
  assert.ok(taxHooks.every(x=>x[0]===tx));
  assert.deepEqual(writes, { paymentsVoided: true, instancesArchived: true, orderArchived: true, mutationRolledBack: true, runRolledBack: true, audit: true });
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
    orderItemInstance: { findMany: async () => [], updateMany: async () => undefined },
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
  for (const relation of ["invoices", "expenses", "agreements", "orderItemInstances", "keycrmLinks", "client"]) assert.match(snapshot, new RegExp(relation));
  assert.match(source, /rollbackEligible/);
  assert.match(source, /rollbackBlockedReason/);
});

test("KeyCRM upsert materializes stable instances for every imported quantity", async () => {
  const KeycrmService = loadKeycrmService();
  let orderRow;
  let itemRow;
  const instances = [];
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined, $queryRaw: async () => [],
    order: {
      findUnique: async ({ where }) => where.number ? null : orderRow || null,
      create: async ({ data }) => (orderRow = { id: "order-1", paymentStatus: "UNPAID", productionStatus: "NOT_SCHEDULED", ...data }),
      update: async ({ data }) => (orderRow = { ...orderRow, ...data }),
    },
    client: { create: async ({ data }) => ({ id: "client-1", ...data }) },
    orderItem: {
      count: async () => 0,
      findUnique: async () => itemRow || null,
      upsert: async ({ create, update }) => itemRow ? (itemRow = { ...itemRow, ...update }) : (itemRow = { id: "item-1", productionStatus: "NOT_SCHEDULED", athleteId: null, measurementId: null, ...create }),
    },
    orderItemInstance: {
      findMany: async ({ where }) => structuredClone(instances.filter(instance => instance.orderItemId === where.orderItemId)),
      create: async ({ data }) => { const row = { id: `instance-${data.ordinal}`, archivedAt: null, ...data }; instances.push(row); return row; },
    },
    payment: { findUnique: async () => null, findMany: async () => [] },
    productionSlot: { findUnique: async () => null }, shipment: { findUnique: async () => null },
    activity: { findFirst: async () => null, create: async () => undefined }, auditLog: { create: async () => undefined },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  await service.importOrder(normalizedOrder({ items: [{ externalId: "item-1", name: "Leotard", quantity: 3, priceMinor: 10000, notes: null, sku: null, externalImageUrl: null, properties: [] }] }), "owner-1", "run-1");
  assert.deepEqual(instances.map(instance => instance.ordinal), [1, 2, 3]);
});

test("KeyCRM create path without external item id materializes instances", async () => {
  const KeycrmService = loadKeycrmService();
  let orderRow;
  const instances = [];
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined, $queryRaw: async () => [],
    order: {
      findUnique: async ({ where }) => where.number ? null : orderRow || null,
      create: async ({ data }) => (orderRow = { id: "order-1", paymentStatus: "UNPAID", productionStatus: "NOT_SCHEDULED", ...data }),
      update: async ({ data }) => (orderRow = { ...orderRow, ...data }),
    },
    client: { create: async ({ data }) => ({ id: "client-1", ...data }) },
    orderItem: {
      count: async () => 0,
      create: async ({ data }) => ({ id: "item-created", productionStatus: "NOT_SCHEDULED", athleteId: null, measurementId: null, ...data }),
    },
    orderItemInstance: {
      findMany: async () => [],
      create: async ({ data }) => { const row = { id: `instance-${data.ordinal}`, archivedAt: null, ...data }; instances.push(row); return row; },
    },
    payment: { findUnique: async () => null, findMany: async () => [] },
    productionSlot: { findUnique: async () => null }, shipment: { findUnique: async () => null },
    activity: { create: async () => undefined }, auditLog: { create: async () => undefined },
  };
  const service = new KeycrmService({ $transaction: callback => callback(tx) });
  await service.importOrder(normalizedOrder({ items: [{ externalId: null, name: "Custom row", quantity: 2, priceMinor: 10000, notes: null, sku: null, externalImageUrl: null, properties: [] }] }), "owner-1", "run-1");
  assert.deepEqual(instances.map(instance => instance.ordinal), [1, 2]);
});

test("повторный APPLY после rollback явно реактивирует order и buyer link", () => {
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  assert.match(source, /discoveredExternalLink && !discoveredExternalLink\.archivedAt && !order\.externalUpdatedAt/);
  assert.match(source, /externallyLinked\?\.archivedAt \? \{ archivedAt: null \}/);
  assert.match(source, /if \(linked\) \{/);
  assert.match(source, /activateImportedClient/);
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
      orderItemInstance: { findMany: async () => [] },
      client: { findMany: async () => [] }, keycrmClientLink: { findMany: async () => [] },
    }),
  });
  await assert.rejects(
    makeService({ id: "m2", externalOrderId: "2", orderId: "o2", kind: "IMPORTED_ORDER", afterSnapshot: { order: { id: "o2", value: "before" }, clients: [], keycrmLinks: [], scope: { orderId: "o2", clientIds: [], connectionKey: "c", keycrmBuyerId: null } }, rollbackEligible: true, rollbackBlockedReason: null, rolledBackAt: null }, { id: "o2", value: "after" }).rollback("run-1", { id: "owner-1" }),
    /изменён после импорта/,
  );
});

test("legacy rollback snapshot fails closed once item instances exist", async () => {
  const KeycrmService = loadKeycrmService();
  const order = { id: "o2", clientId: "client-1", number: "K-2", items: [], payments: [], productionSlot: null, shipment: null, invoices: [], expenses: [], agreements: [] };
  const scope = { orderId: "o2", clientIds: [], connectionKey: "c", keycrmBuyerId: null };
  const mutation = { id: "m2", externalOrderId: "2", orderId: "o2", kind: "IMPORTED_ORDER", afterSnapshot: { order, clients: [], keycrmLinks: [], scope }, rollbackEligible: true, rollbackBlockedReason: null, rolledBackAt: null };
  const service = new KeycrmService({
    $transaction: callback => callback({
      $executeRaw: async () => undefined,
      $executeRawUnsafe: async () => undefined,
      keycrmSyncRun: { findUnique: async () => ({ id: "run-1", mode: "APPLY", status: "PARTIAL", rolledBackAt: null, mutations: [mutation] }) },
      order: { findUnique: async () => order },
      orderItemInstance: { findMany: async () => [{ id: "instance-1", orderItemId: "item-1", ordinal: 1, archivedAt: null }] },
      client: { findMany: async () => [] }, keycrmClientLink: { findMany: async () => [] },
    }),
  });
  await assert.rejects(() => service.rollback("run-1", { id: "owner-1" }), /изменён после импорта/);
});

test("legacy rollback snapshot fails closed once plural shipments exist", async () => {
  const KeycrmService = loadKeycrmService();
  const order = { id: "o2", clientId: "client-1", number: "K-2", items: [], payments: [], productionSlot: null, shipment: null, invoices: [], expenses: [], agreements: [] };
  const scope = { orderId: "o2", clientIds: [], connectionKey: "c", keycrmBuyerId: null };
  const mutation = { id: "m2", externalOrderId: "2", orderId: "o2", kind: "IMPORTED_ORDER", afterSnapshot: { order, clients: [], keycrmLinks: [], scope }, rollbackEligible: true, rollbackBlockedReason: null, rolledBackAt: null };
  const service = new KeycrmService({
    $transaction: callback => callback({
      $executeRaw: async () => undefined,
      $executeRawUnsafe: async () => undefined,
      keycrmSyncRun: { findUnique: async () => ({ id: "run-1", mode: "APPLY", status: "PARTIAL", rolledBackAt: null, mutations: [mutation] }) },
      order: { findUnique: async () => order },
      orderItemInstance: { findMany: async () => [] },
      orderShipment: { findMany: async () => [{ id: "shipment-1", orderId: "o2", archivedAt: null }] },
      client: { findMany: async () => [] }, keycrmClientLink: { findMany: async () => [] },
    }),
  });
  await assert.rejects(() => service.rollback("run-1", { id: "owner-1" }), /изменён после импорта/);
});

test("unknown rollback snapshot versions fail closed before writes", async () => {
  const KeycrmService = loadKeycrmService();
  const mutation = { id: "m2", externalOrderId: "2", orderId: "o2", kind: "IMPORTED_ORDER", afterSnapshot: { version: 3, order: { id: "o2" }, orderItemInstances: [], clients: [], keycrmLinks: [], scope: { orderId: "o2", clientIds: [], connectionKey: "c", keycrmBuyerId: null } }, rollbackEligible: true, rollbackBlockedReason: null, rolledBackAt: null };
  const service = new KeycrmService({ $transaction: callback => callback({
    $executeRaw: async () => undefined,
    $executeRawUnsafe: async () => undefined,
    keycrmSyncRun: { findUnique: async () => ({ id: "run-1", mode: "APPLY", status: "PARTIAL", rolledBackAt: null, mutations: [mutation] }) },
  }) });
  await assert.rejects(() => service.rollback("run-1", { id: "owner-1" }), /несовместимую версию/);
});

test("version 2 rollback snapshot without plural shipments fails closed", async () => {
  const KeycrmService = loadKeycrmService();
  const mutation = { id: "m2", externalOrderId: "2", orderId: "o2", kind: "IMPORTED_ORDER", afterSnapshot: { version: 2, order: { id: "o2" }, orderItemInstances: [], clients: [], keycrmLinks: [], scope: { orderId: "o2", clientIds: [], connectionKey: "c", keycrmBuyerId: null } }, rollbackEligible: true, rollbackBlockedReason: null, rolledBackAt: null };
  const service = new KeycrmService({ $transaction: callback => callback({
    $executeRaw: async () => undefined,
    $executeRawUnsafe: async () => undefined,
    keycrmSyncRun: { findUnique: async () => ({ id: "run-1", mode: "APPLY", status: "PARTIAL", rolledBackAt: null, mutations: [mutation] }) },
  }) });
  await assert.rejects(() => service.rollback("run-1", { id: "owner-1" }), /несовместимый формат/);
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
      count: async ({ where }) => orderRow?.modelImagePath === where.modelImagePath ? 1 : 0,
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
    orderItemInstance: { findMany: async () => [], create: async () => undefined },
    payment: { findUnique: async () => null, findMany: async () => [] }, productionSlot: { findUnique: async () => null }, shipment: { findUnique: async () => null },
    activity: { findFirst: async () => null, create: async () => undefined }, auditLog: { create: async () => undefined }, keycrmSyncIssue: { findFirst: async () => null, create: async () => undefined },
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

test('reimport preserves provider item tombstone and never reconciles or rewrites archived pieces',async()=>{
 const KeycrmService=loadKeycrmService();
 const historical={id:'provider-item',orderId:'order-1',sourceSystem:'KEYCRM',sourceAccount:'connection-1',externalId:'product-1',quantity:2,priceMinor:10000,archivedAt:new Date('2026-10-10')};
 const existing={id:'order-1',number:'K-1',clientId:'client-1',sourceLinkMode:'IMPORTED',currency:'EUR',externalUpdatedAt:new Date('2026-10-01'),depositRequiredMinor:5000,priceMinor:10000,type:OrderType.CUSTOM_ORDER,paymentStatus:'UNPAID',productionStatus:'NOT_SCHEDULED'};
 let itemWrites=0,instanceWrites=0;const issues=[];
 const tx={$executeRaw:async()=>undefined,$executeRawUnsafe:async()=>undefined,$queryRaw:async()=>[],
  order:{findUnique:async()=>existing,update:async({data})=>({...existing,...data})},
  clientMergeRedirect:{findUnique:async()=>null},client:{findUniqueOrThrow:async()=>({id:'client-1',email:null,phone:null,country:null,city:null,address:null,postalCode:null})},
  orderItem:{count:async()=>0,findUnique:async()=>historical,upsert:async()=>{itemWrites++;return historical}},
  orderItemInstance:{findMany:async()=>[],create:async()=>{instanceWrites++}},
  payment:{findMany:async()=>[],findUnique:async()=>null},productionSlot:{findUnique:async()=>null},shipment:{findUnique:async()=>null},
  activity:{findFirst:async()=>null,create:async()=>undefined},auditLog:{create:async()=>undefined},keycrmSyncIssue:{findFirst:async()=>null,create:async({data})=>issues.push(data)}};
 const service=new KeycrmService({$transaction:callback=>callback(tx)});
 const incoming=normalizedOrder({items:[{externalId:'product-1',name:'Provider',quantity:3,priceMinor:10000,notes:null,sku:null,externalImageUrl:null,properties:[]}]});
 for(let n=0;n<2;n++)assert.equal(await service.importOrder(incoming,'owner-1','run-1'),'UPDATED');
 assert.equal(itemWrites,0);assert.equal(instanceWrites,0);assert.ok(historical.archivedAt);assert.equal(historical.quantity,2);
 assert.ok(issues.some(row=>row.code==='ARCHIVED_ORDER_ITEM_PRESERVED'));
});

for(const archived of [false,true])test('legacy rollback snapshot handles additive null fields but protects new archive '+archived,async()=>{
 const KeycrmService=loadKeycrmService();const item={id:'item-1'};
 const old={id:'o',clientId:'c',items:[item],payments:[],productionSlot:null,shipment:null,invoices:[],expenses:[],agreements:[]};
 const current={...old,items:[{...item,archivedAt:archived?'2026-10-15T10:00:00.000Z':null,discipline:null}]};
 const scope={orderId:'o',clientIds:[],connectionKey:'connection-1',keycrmBuyerId:null};
 const after={version:2,scope,order:old,orderItemInstances:[],orderShipments:[],clients:[],keycrmLinks:[]};
 const mutation={id:'m',externalOrderId:'1',orderId:'o',kind:'IMPORTED_ORDER',beforeSnapshot:{...after,scope:{...scope,orderId:null},order:null},afterSnapshot:after,rollbackEligible:true,rolledBackAt:null};
 const run={id:'r',mode:'APPLY',status:'FAILED',rollbackEligible:true,mutations:[mutation]};let writes=0;
 const tx={$executeRaw:async()=>undefined,$executeRawUnsafe:async()=>undefined,
  keycrmSyncRun:{findUnique:async()=>run,update:async({data})=>Object.assign(run,data)},
  order:{findUnique:async()=>current,update:async()=>{writes++},count:async()=>0},
  orderItem:{updateMany:async()=>undefined,count:async()=>0},orderItemInstance:{findMany:async()=>[],updateMany:async()=>undefined},
  client:{findMany:async()=>[]},keycrmClientLink:{findMany:async()=>[]},payment:{updateMany:async()=>undefined},
  activity:{create:async()=>undefined},auditLog:{create:async()=>undefined},keycrmSyncMutation:{update:async()=>undefined}};
 const service=new KeycrmService({$transaction:fn=>fn(tx),keycrmSyncRun:{findUnique:async()=>({...run,_count:{issues:0}})}});
 if(archived){await assert.rejects(()=>service.rollback('r',{id:'owner'}),/изменён после импорта/);assert.equal(writes,0)}
 else {await service.rollback('r',{id:'owner'});assert.equal(writes,1)}
 assert.equal(JSON.stringify(item),'\u007b"id":"item-1"}');
});

test('local add or duplicate on imported order preserves its commercial total on repeated import',async()=>{
 const KeycrmService=loadKeycrmService();const updates=[];
 const existing={id:'order-1',number:'K-1',clientId:'client-1',sourceLinkMode:'IMPORTED',currency:'EUR',externalUpdatedAt:new Date('2026-10-01'),depositRequiredMinor:12500,priceMinor:25000,type:OrderType.CUSTOM_ORDER,paymentStatus:'UNPAID',productionStatus:'NOT_SCHEDULED'};
 const tx={$executeRaw:async()=>undefined,$executeRawUnsafe:async()=>undefined,$queryRaw:async()=>[],order:{findUnique:async()=>existing,update:async({data})=>{updates.push(data);return {...existing,...data}}},clientMergeRedirect:{findUnique:async()=>null},client:{findUniqueOrThrow:async()=>({id:'client-1',email:null,phone:null,country:null,city:null,address:null,postalCode:null})},orderItem:{count:async()=>1},orderItemInstance:{findMany:async()=>[]},payment:{findMany:async()=>[],findUnique:async()=>null},productionSlot:{findUnique:async()=>null},shipment:{findUnique:async()=>null},activity:{findFirst:async()=>null,create:async()=>undefined},auditLog:{create:async()=>undefined},keycrmSyncIssue:{findFirst:async()=>null,create:async()=>undefined}};
 const service=new KeycrmService({$transaction:fn=>fn(tx)});let slotSyncs=0;service.syncProductionSlot=async()=>{slotSyncs++};
 for(let n=0;n<2;n++)await service.importOrder(normalizedOrder(),'owner-1','r');
 assert.equal(slotSyncs,0);assert.ok(updates.length);assert.equal(updates[0].priceMinor,25000);assert.equal(updates[0].depositRequiredMinor,12500);
});

function localCompositionImportFixture({ manualItemOverride = false, compositionEvent = false, manualDiscount = false, manualPrice = false, taxes } = {}) {
  const state = {
    order: { id: 'order-1', number: 'K-1', clientId: 'client-1', sourceLinkMode: 'IMPORTED', sourceSystem: 'KEYCRM', sourceAccount: 'connection-1', externalId: 'order-1', currency: 'EUR', externalUpdatedAt: new Date('2026-10-01'), depositRequiredMinor: 12500, priceMinor: 25000, type: OrderType.CUSTOM_ORDER, paymentStatus: 'PARTIALLY_PAID', productionStatus: 'NOT_SCHEDULED' },
    items: [
      { id: 'provider-item', orderId: 'order-1', sourceSystem: 'KEYCRM', sourceAccount: 'connection-1', externalId: 'product-1', name: 'Provider', quantity: 1, priceMinor: 10000, archivedAt: null, productionStatus: 'NOT_SCHEDULED' },
      { id: 'local-item', orderId: 'order-1', sourceSystem: null, name: 'Manual addition', quantity: 1, priceMinor: 15000, archivedAt: null, productionStatus: 'NOT_SCHEDULED' },
    ],
    instances: [{ id: 'provider-piece', orderItemId: 'provider-item', ordinal: 1, archivedAt: null, productionStatus: 'NOT_SCHEDULED', athleteId: 'a1', measurementId: 'm1' }],
    payments: [{ id: 'receipt', amountMinor: 5000, currency: 'EUR', reference: 'Immutable receipt' }],
    invoices: [{ id: 'invoice', totalMinor: 25000, status: 'ISSUED' }],
    audits: [], activities: [],
  };
  if (compositionEvent) {
    state.items.splice(1);
    state.order.priceMinor = 10000; state.order.depositRequiredMinor = 5000;
  }
  const issues = [];
  let businessWrites = 0;
  const tx = {
    $executeRaw: async () => undefined, $executeRawUnsafe: async () => undefined, $queryRaw: async () => [],
    order: { findUnique: async () => structuredClone(state.order), update: async ({ data }) => { businessWrites++; Object.assign(state.order, data); return structuredClone(state.order); } },
    clientMergeRedirect: { findUnique: async () => null },
    client: { findUniqueOrThrow: async () => ({ id: 'client-1', email: null, phone: null, country: null, city: null, address: null, postalCode: null }) },
    orderItem: {
      count: async () => state.items.filter(item => item.sourceSystem !== 'KEYCRM').length,
      findUnique: async ({ where }) => structuredClone(state.items.find(item => item.externalId === where.sourceSystem_sourceAccount_externalId.externalId) ?? null),
      upsert: async ({ where, create, update }) => {
        businessWrites++;
        let item = state.items.find(item => item.externalId === where.sourceSystem_sourceAccount_externalId.externalId);
        if (item) Object.assign(item, update); else { item = { id: 'new-provider-item', ...create }; state.items.push(item); }
        return structuredClone(item);
      },
    },
    orderItemInstance: {
      findMany: async ({ where }) => structuredClone(state.instances.filter(instance => instance.orderItemId === where.orderItemId)),
      create: async ({ data }) => { businessWrites++; const instance = { id: 'new-piece', archivedAt: null, ...data }; state.instances.push(instance); return structuredClone(instance); },
    },
    payment: { findMany: async () => structuredClone(state.payments), findUnique: async () => null },
    productionSlot: { findUnique: async () => null }, shipment: { findUnique: async () => null },
    activity: { findFirst: async ({ where }) => where.type === 'ORDER_DISCOUNT_UPDATED' ? manualDiscount ? { id: 'discount-override' } : null : where.OR ? manualPrice ? {id:'manual-price'} : null : where.AND ? manualItemOverride ? { id: 'item-override' } : null : compositionEvent && where.metadata?.path?.[0] === 'composition' ? { id: 'composition-event' } : null, create: async ({ data }) => { businessWrites++; state.activities.push(data); } },
    auditLog: { create: async ({ data }) => { businessWrites++; state.audits.push(data); } },
    keycrmSyncIssue: { findFirst: async () => null, create: async ({ data }) => { issues.push(data); return data; } },
  };
  const KeycrmService = loadKeycrmService({ reconcileOrderItemInstances: loadTargetModule('orders/order-item-details.ts').reconcileOrderItemInstances });
  const service = new KeycrmService({ $transaction: async callback => {
    const before=structuredClone(state),beforeWrites=businessWrites;
    try{return await callback(tx)}catch(error){Object.assign(state,before);businessWrites=beforeWrites;throw error}
  } }, taxes);
  return { state, issues, service, tx, get businessWrites() { return businessWrites; } };
}

function shipmentCurrencyImportFixture(shipmentOverrides = {}) {
  const f = localCompositionImportFixture();
  const shipment = {
    id: 'parcel-1', orderId: 'order-1', externalServiceId: 'service-1',
    customerChargeMinor: 900, currency: 'EUR', archivedAt: null, updatedAt: new Date('2026-10-01'),
    customerChargeOriginalMinor: 1000, customerChargeOriginalCurrency: 'USD',
    customerChargeRateSnapshot: { source: 'ECB', numerator: '9', denominator: '10' },
    ...shipmentOverrides,
  };
  const writes = [];
  f.tx.orderShipment = {
    findMany: async () => [structuredClone(shipment)],
    update: async ({ data }) => {
      writes.push(data);
      Object.assign(shipment, data, data.customerChargeRateSnapshot === Prisma.DbNull ? { customerChargeRateSnapshot: null } : {});
      return structuredClone(shipment);
    },
  };
  f.tx.shipment = { findUnique: async () => ({ id: 'legacy-shipment', shippedAt: new Date('2026-10-01') }) };
  const incoming = normalizedOrder({
    deliveryMinor: 900,
    delivery: { ...normalizedOrder().delivery, serviceId: 'service-1', serviceName: 'DHL', trackingCode: 'TRACK-1', externalStatus: 'in_transit' },
    items: [{ externalId: 'product-1', name: 'Provider', quantity: 1, priceMinor: 10000, notes: null, sku: null, externalImageUrl: null, properties: [] }],
  });
  return { ...f, shipment, writes, incoming };
}

test('KeyCRM changed applied shipment charge clears foreign provenance in the same write', async () => {
  const f = shipmentCurrencyImportFixture();
  f.incoming.deliveryMinor = 1200;
  assert.equal(await f.service.importOrder(f.incoming, 'owner', 'run-1'), 'UPDATED');
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].customerChargeMinor, 1200);
  assert.equal(f.writes[0].currency, 'EUR');
  assert.equal(f.writes[0].customerChargeOriginalMinor, null);
  assert.equal(f.writes[0].customerChargeOriginalCurrency, null);
  assert.equal(f.writes[0].customerChargeRateSnapshot, Prisma.DbNull);
});

test('KeyCRM unchanged applied money and status sync preserve foreign provenance', async () => {
  const f = shipmentCurrencyImportFixture();
  const before = structuredClone(f.shipment.customerChargeRateSnapshot);
  assert.equal(await f.service.importOrder(f.incoming, 'owner', 'run-1'), 'UPDATED');
  assert.equal(f.shipment.externalStatus, 'in_transit');
  assert.equal(f.shipment.customerChargeMinor, 900);
  assert.equal(f.shipment.currency, 'EUR');
  assert.equal(f.shipment.customerChargeOriginalMinor, 1000);
  assert.equal(f.shipment.customerChargeOriginalCurrency, 'USD');
  assert.deepEqual(f.shipment.customerChargeRateSnapshot, before);
  for (const field of ['customerChargeOriginalMinor', 'customerChargeOriginalCurrency', 'customerChargeRateSnapshot']) assert.equal(Object.hasOwn(f.writes[0], field), false);
});

test('KeyCRM changed applied currency clears provenance even when the minor amount is unchanged', async () => {
  const f = shipmentCurrencyImportFixture({ currency: 'USD' });
  await f.service.importOrder(f.incoming, 'owner', 'run-1');
  assert.equal(f.shipment.customerChargeMinor, 900);
  assert.equal(f.shipment.currency, 'EUR');
  assert.equal(f.shipment.customerChargeOriginalMinor, null);
  assert.equal(f.shipment.customerChargeOriginalCurrency, null);
  assert.equal(f.writes[0].customerChargeRateSnapshot, Prisma.DbNull);
});

test('KeyCRM new parcel leaves original money at SQL NULL defaults', async () => {
  const f = shipmentCurrencyImportFixture();
  f.tx.orderShipment.findMany = async () => [];
  let created;
  f.tx.orderShipment.create = async ({ data }) => {
    created = { customerChargeOriginalMinor: null, customerChargeOriginalCurrency: null, customerChargeRateSnapshot: null, ...data };
    return { id: 'new-parcel', ...created };
  };
  await f.service.importOrder(f.incoming, 'owner', 'run-1');
  assert.equal(created.customerChargeMinor, 900);
  assert.equal(created.currency, 'EUR');
  assert.equal(created.customerChargeOriginalMinor, null);
  assert.equal(created.customerChargeOriginalCurrency, null);
  assert.equal(created.customerChargeRateSnapshot, null);
});

function captureShipmentMutation(f) {
  const run = { id: 'run-1', mode: 'APPLY', status: 'PARTIAL', rolledBackAt: null, mutations: [] };
  f.tx.keycrmSyncMutation = {
    count: async () => run.mutations.length,
    create: async ({ data }) => { const row = { id: 'mutation-1', rolledBackAt: null, ...data }; run.mutations.push(row); return row; },
    update: async () => undefined,
  };
  f.tx.keycrmSyncRun = { findUnique: async () => run, update: async ({ data }) => Object.assign(run, data) };
  f.service.prisma.keycrmSyncRun = f.tx.keycrmSyncRun;
  return run;
}

test('KeyCRM v2 import snapshots roundtrip foreign shipment provenance through public rollback', async () => {
  const f = shipmentCurrencyImportFixture();
  const run = captureShipmentMutation(f);
  f.incoming.deliveryMinor = 1200;
  await f.service.importOrder(f.incoming, 'owner', 'run-1');
  const mutation = run.mutations[0];
  const saved = JSON.stringify([mutation.beforeSnapshot, mutation.afterSnapshot]);
  assert.equal(mutation.beforeSnapshot.version, 2);
  assert.deepEqual(structuredClone(mutation.beforeSnapshot.orderShipments[0].customerChargeRateSnapshot), { source: 'ECB', numerator: '9', denominator: '10' });
  assert.equal(mutation.beforeSnapshot.orderShipments[0].customerChargeOriginalMinor, 1000);
  assert.equal(mutation.afterSnapshot.orderShipments[0].customerChargeOriginalMinor, null);
  assert.equal(mutation.afterSnapshot.orderShipments[0].customerChargeRateSnapshot, null);
  await f.service.rollback('run-1', { id: 'owner' });
  assert.equal(f.shipment.customerChargeMinor, 900);
  assert.equal(f.shipment.customerChargeOriginalMinor, 1000);
  assert.equal(f.shipment.customerChargeOriginalCurrency, 'USD');
  assert.deepEqual(structuredClone(f.shipment.customerChargeRateSnapshot), { source: 'ECB', numerator: '9', denominator: '10' });
  assert.equal(JSON.stringify([mutation.beforeSnapshot, mutation.afterSnapshot]), saved);
});

test('KeyCRM rollback restores SQL DbNull for an explicitly null shipment rate snapshot', async () => {
  const f = shipmentCurrencyImportFixture({ customerChargeOriginalMinor: null, customerChargeOriginalCurrency: null, customerChargeRateSnapshot: null });
  captureShipmentMutation(f);
  await f.service.importOrder(f.incoming, 'owner', 'run-1');
  await f.service.rollback('run-1', { id: 'owner' });
  assert.equal(f.writes.at(-1).customerChargeOriginalMinor, null);
  assert.equal(f.writes.at(-1).customerChargeOriginalCurrency, null);
  assert.equal(f.writes.at(-1).customerChargeRateSnapshot, Prisma.DbNull);
});

for (const [label, laterProvenance] of [
  ['NULL', null],
  ['foreign triple', { customerChargeOriginalMinor: 1000, customerChargeOriginalCurrency: 'USD', customerChargeRateSnapshot: { source: 'ECB', numerator: '9', denominator: '10' } }],
  ['zero original amount', { customerChargeOriginalMinor: 0 }],
  ['empty original currency', { customerChargeOriginalCurrency: '' }],
  ['empty JSON snapshot', { customerChargeRateSnapshot: {} }],
]) test('KeyCRM old v2 shipment snapshot accepts only additive NULL provenance: ' + label, async () => {
  const f = shipmentCurrencyImportFixture({ customerChargeOriginalMinor: null, customerChargeOriginalCurrency: null, customerChargeRateSnapshot: null });
  const run = captureShipmentMutation(f);
  await f.service.importOrder(f.incoming, 'owner', 'run-1');
  const mutation = run.mutations[0];
  for (const snapshot of [mutation.beforeSnapshot, mutation.afterSnapshot]) {
    for (const field of ['customerChargeOriginalMinor', 'customerChargeOriginalCurrency', 'customerChargeRateSnapshot']) delete snapshot.orderShipments[0][field];
  }
  const saved = JSON.stringify([mutation.beforeSnapshot, mutation.afterSnapshot]);
  f.writes.length = 0;
  if (laterProvenance) {
    Object.assign(f.shipment, laterProvenance);
    await assert.rejects(() => f.service.rollback('run-1', { id: 'owner' }), /изменён после импорта/);
    assert.equal(f.writes.length, 0);
    assert.equal(run.rolledBackAt, null);
  } else {
    await f.service.rollback('run-1', { id: 'owner' });
    assert.equal(f.shipment.customerChargeMinor, 900);
    assert.equal(f.shipment.customerChargeOriginalMinor, null);
    assert.equal(f.shipment.customerChargeOriginalCurrency, null);
    assert.equal(f.shipment.customerChargeRateSnapshot, null);
    assert.equal(f.writes.length, 1);
  }
  assert.equal(JSON.stringify([mutation.beforeSnapshot, mutation.afterSnapshot]), saved);
});

test('local composition conflict skips provider quantity growth before any business mutation, including retry', async () => {
  const f = localCompositionImportFixture(), before = structuredClone(f.state);
  const incoming = normalizedOrder({ priceMinor: 20000, items: [{ externalId: 'product-1', name: 'Provider', quantity: 2, priceMinor: 10000, notes: null, sku: null, externalImageUrl: null, properties: [] }] });
  for (let attempt = 0; attempt < 2; attempt++) assert.equal(await f.service.importOrder(incoming, 'owner', 'run-1'), 'SKIPPED');
  assert.equal(f.businessWrites, 0);
  assert.deepEqual(f.state, before);
  assert.ok(f.issues.some(issue => issue.code === 'LOCAL_COMPOSITION_IMPORT_CONFLICT' && /состав|количеств/i.test(issue.message)));
});

for (const [reason, line] of [
  ['quantity decrease', { externalId: 'product-1', quantity: 1, priceMinor: 10000 }],
  ['price change', { externalId: 'product-1', quantity: 1, priceMinor: 12000 }],
  ['new provider line', { externalId: 'product-2', quantity: 1, priceMinor: 5000 }],
]) test(`local composition conflict skips ${reason} before business writes`, async () => {
  const f = localCompositionImportFixture();
  if (reason === 'quantity decrease') {
    f.state.items[0].quantity = 2;
    f.state.order.priceMinor = 35000; f.state.order.depositRequiredMinor = 17500;
    f.state.instances.push({ ...f.state.instances[0], id: 'provider-piece-2', ordinal: 2 });
  }
  const before = structuredClone(f.state);
  const incoming = normalizedOrder({ items: [{ name: 'Provider', notes: null, sku: null, externalImageUrl: null, properties: [], ...line }] });
  assert.equal(await f.service.importOrder(incoming, 'owner', 'run-1'), 'SKIPPED');
  assert.equal(f.businessWrites, 0); assert.deepEqual(f.state, before);
  assert.equal(f.issues[0].code, 'LOCAL_COMPOSITION_IMPORT_CONFLICT');
});

test('local composition conflict also protects composition intent recorded without a local-only item', async () => {
  const f = localCompositionImportFixture({ compositionEvent: true }), before = structuredClone(f.state);
  assert.equal(await f.service.importOrder(normalizedOrder({ items: [{ externalId: 'product-1', name: 'Provider', quantity: 2, priceMinor: 10000 }] }), 'owner', 'run-1'), 'SKIPPED');
  assert.equal(f.businessWrites, 0); assert.deepEqual(f.state, before);
  assert.equal(f.issues[0].code, 'LOCAL_COMPOSITION_IMPORT_CONFLICT');
});

test('local composition conflict preflights every provider line before updating an earlier compatible line', async () => {
  const f = localCompositionImportFixture(), before = structuredClone(f.state);
  const incoming = normalizedOrder({ items: [
    { externalId: 'product-1', name: 'Compatible metadata update', quantity: 1, priceMinor: 10000 },
    { externalId: 'product-2', name: 'New provider line', quantity: 1, priceMinor: 5000 },
  ] });
  assert.equal(await f.service.importOrder(incoming, 'owner', 'run-1'), 'SKIPPED');
  assert.equal(f.businessWrites, 0); assert.deepEqual(f.state, before);
  assert.equal(f.issues[0].details.externalItemId, 'product-2');
});

test('local composition keeps compatible unchanged provider imports and repeat imports working', async () => {
  const f = localCompositionImportFixture(), pieces = structuredClone(f.state.instances), receipts = structuredClone(f.state.payments), invoices = structuredClone(f.state.invoices);
  const incoming = normalizedOrder({ items: [{ externalId: 'product-1', name: 'Provider', quantity: 1, priceMinor: 10000, notes: null, sku: null, externalImageUrl: null, properties: [] }] });
  assert.equal(await f.service.importOrder(incoming, 'owner', 'run-1'), 'UPDATED');
  assert.equal(await f.service.importOrder(incoming, 'owner', 'run-1'), 'SKIPPED');
  assert.equal(f.issues.length, 0); assert.equal(f.state.order.priceMinor, 25000); assert.equal(f.state.order.depositRequiredMinor, 12500);
  assert.equal(f.state.items[1].priceMinor, 15000); assert.deepEqual(f.state.instances, pieces);
  assert.deepEqual(f.state.payments, receipts); assert.deepEqual(f.state.invoices, invoices);
});

test('local composition retains explicitly overridden lines and tombstones instead of conflicting on their suppressed provider writes', async () => {
  for (const archived of [false, true]) {
    const f = localCompositionImportFixture({ manualItemOverride: !archived });
    if (archived) f.state.items[0].archivedAt = new Date('2026-10-10');
    const items = structuredClone(f.state.items), pieces = structuredClone(f.state.instances);
    assert.equal(await f.service.importOrder(normalizedOrder({ items: [{ externalId: 'product-1', name: 'Provider', quantity: 2, priceMinor: 10000 }] }), 'owner', 'run-1'), 'UPDATED');
    assert.deepEqual(f.state.items, items); assert.deepEqual(f.state.instances, pieces);
    assert.equal(f.state.order.priceMinor, 25000);
    assert.equal(f.issues.some(issue => issue.code === 'LOCAL_COMPOSITION_IMPORT_CONFLICT'), false);
  }
});

test('local composition keeps matched-existing manual items on their original preserve-items import path', async () => {
  const f = localCompositionImportFixture({ compositionEvent: true });
  f.state.order.sourceLinkMode = 'MATCHED_EXISTING';
  const pieces = structuredClone(f.state.instances);
  // This linked order already preserves all CRM items rather than applying provider lines.
  // Give that existing ownership branch its actual non-provider item count.
  f.state.items[0].sourceSystem = null;
  const expectedItems = structuredClone(f.state.items);
  assert.equal(await f.service.importOrder(normalizedOrder({ items: [{ externalId: 'new-provider-line', name: 'Provider', quantity: 2, priceMinor: 10000 }] }), 'owner', 'run-1'), 'UPDATED');
  assert.deepEqual(f.state.items, expectedItems); assert.deepEqual(f.state.instances, pieces);
  assert.equal(f.issues.some(issue => issue.code === 'LOCAL_COMPOSITION_IMPORT_CONFLICT'), false);
  assert.ok(f.issues.some(issue => issue.code === 'MATCHED_ORDER_ITEMS_PRESERVED'));
});


test('manual discount survives import while unrelated provider quantities and authoritative base continue updating', async () => {
 const f=localCompositionImportFixture({manualDiscount:true});f.state.items.splice(1);
 Object.assign(f.state.order,{priceMinor:8000,discountMinor:2000,depositRequiredMinor:4000});
 const receipts=structuredClone(f.state.payments),invoices=structuredClone(f.state.invoices);
 const incoming=normalizedOrder({priceMinor:19000,discountMinor:1000,items:[{externalId:'product-1',name:'Provider',quantity:2,priceMinor:10000}]});
 assert.equal(await f.service.importOrder(incoming,'owner','run-1'),'UPDATED');
 assert.equal(f.state.order.discountMinor,2000);assert.equal(f.state.order.priceMinor,18000);
 assert.equal(f.state.items[0].quantity,2);assert.equal(f.state.instances.length,2);
 assert.deepEqual(f.state.payments,receipts);assert.deepEqual(f.state.invoices,invoices);
});

test('100 percent manual discount with existing receipt keeps PAID after import; legacy zero policy is unchanged',async()=>{
 for(const manualDiscount of [true,false]){
  const f=localCompositionImportFixture({manualDiscount});f.state.items.splice(1);Object.assign(f.state.order,{priceMinor:0,discountMinor:10000,depositRequiredMinor:0,paymentStatus:'PAID'});
  await f.service.importOrder(normalizedOrder({priceMinor:0,discountMinor:10000,items:[{externalId:'product-1',name:'Provider',quantity:1,priceMinor:10000}]}),'owner','run-1');
  assert.equal(f.state.order.paymentStatus,manualDiscount?'PAID':'DEPOSIT_PAID');assert.equal(f.state.order.priceMinor,0);
 }
});

test('manual fixed amount survives independent provider decrease while lines still update',async()=>{
 const f=localCompositionImportFixture({manualDiscount:true});f.state.items.splice(1);Object.assign(f.state.order,{priceMinor:18000,discountMinor:2000,depositRequiredMinor:9000});f.state.items[0].priceMinor=20000;
 await f.service.importOrder(normalizedOrder({priceMinor:8000,discountMinor:1000,items:[{externalId:'product-1',name:'Provider',quantity:1,priceMinor:9000}]}),'owner','run-1');
 assert.equal(f.state.order.priceMinor,7000);assert.equal(f.state.order.discountMinor,2000);assert.equal(f.state.items[0].priceMinor,9000);
});

test('manual price remains authoritative together with discount; no marker retains ordinary provider pricing',async()=>{
 for(const manualDiscount of [true,false]){
  const f=localCompositionImportFixture({manualDiscount,manualPrice:manualDiscount});f.state.items.splice(1);Object.assign(f.state.order,{priceMinor:8000,discountMinor:2000,depositRequiredMinor:2400});
  await f.service.importOrder(normalizedOrder({priceMinor:19000,discountMinor:1000,items:[{externalId:'product-1',name:'Provider',quantity:1,priceMinor:20000}]}),'owner','run-1');
  assert.equal(f.state.order.priceMinor,manualDiscount?8000:19000);assert.equal(f.state.order.discountMinor,manualDiscount?2000:1000);assert.equal(f.state.items[0].priceMinor,20000);
 }
});

test('explicit zero manual discount removes provider discount, and currency mismatch writes nothing',async()=>{
 const f=localCompositionImportFixture({manualDiscount:true});f.state.items.splice(1);Object.assign(f.state.order,{priceMinor:10000,discountMinor:0,depositRequiredMinor:5000});
 const before=structuredClone(f.state);assert.equal(await f.service.importOrder(normalizedOrder({currency:'USD'}),'owner','run-1'),'SKIPPED');assert.deepEqual(f.state,before);assert.equal(f.businessWrites,0);assert.equal(f.issues[0].code,'ORDER_CURRENCY_CHANGED');
 await f.service.importOrder(normalizedOrder({priceMinor:9000,discountMinor:1000,items:[{externalId:'product-1',name:'Provider',quantity:1,priceMinor:10000}]}),'owner','run-1');assert.equal(f.state.order.priceMinor,10000);assert.equal(f.state.order.discountMinor,0);
});

for(const priceMinor of [500,2147483647])test('manual discount rejects invalid provider replacement atomically '+priceMinor,async()=>{
 const f=localCompositionImportFixture({manualDiscount:true});f.state.items.splice(1);Object.assign(f.state.order,{priceMinor:8000,discountMinor:2000});const before=structuredClone(f.state);
 const discountMinor=priceMinor===500?0:10000;
 await assert.rejects(f.service.importOrder(normalizedOrder({priceMinor,discountMinor}),'owner','run-1'),e=>e.getStatus()===409);assert.deepEqual(f.state,before);assert.equal(f.businessWrites,0);
});

for(const changedValue of [false,true])for(const importedNew of [false,true])test((changedValue?'changed-value':'same-value')+' discount intent blocks prior import rollback '+(importedNew?'archive':'restore'),async()=>{
 const {applyOrderDiscount}=loadTargetModule('orders/order-discount-write.ts'),{compositionToken}=loadTargetModule('orders/order-composition.ts');
 const root={id:'discount-order',clientId:'c',number:'KC-test',currency:'EUR',type:'CUSTOM_ORDER',priceMinor:9000,discountMinor:1000,depositRequiredMinor:4500,paymentStatus:'UNPAID',salesStatus:'NEW_LEAD',productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',updatedAt:new Date(Date.now()+60000),items:[],payments:[],invoices:[],expenses:[],agreements:[],productionSlot:null,shipment:null};
 const scope={orderId:root.id,clientIds:[],connectionKey:'connection',keycrmBuyerId:null},activities=[],operations=[];let mutation,run,rollbackWrites=0;
 const tx={$executeRaw:async()=>0,$executeRawUnsafe:async()=>0,$queryRaw:async()=>[],
  order:{findFirst:async()=>({...structuredClone(root),client:{id:'c',archivedAt:null}}),findUnique:async()=>structuredClone(root),update:async({data})=>{if(data.archivedAt||data.priceMinor!==undefined)rollbackWrites++;Object.assign(root,data);return structuredClone(root)}},
  orderCompositionOperation:{findUnique:async()=>operations[0]??null,create:async({data})=>{const op={id:'discount-operation',...data};operations.push(op);return op}},
  activity:{create:async({data})=>{activities.push(data);return data}},auditLog:{create:async()=>({})},
  orderItemInstance:{findMany:async()=>[],updateMany:async()=>({count:0})},orderItem:{updateMany:async()=>({count:0})},payment:{updateMany:async()=>({count:0})},
  keycrmSyncRun:{findUnique:async()=>run,update:async({data})=>Object.assign(run,data)},keycrmSyncMutation:{update:async({data})=>Object.assign(mutation,data)}};
 const KeycrmService=loadKeycrmService(),service=new KeycrmService({$transaction:fn=>fn(tx),keycrmSyncRun:{findUnique:async()=>({...run,_count:{issues:0}})}});
 const after=await service.rollbackSnapshot(tx,scope),before=structuredClone(after);
 if(importedNew){before.scope.orderId=null;before.order=null}else{before.order.discountMinor=0;before.order.priceMinor=10000;before.order.depositRequiredMinor=5000}
 mutation={id:'mutation',orderId:root.id,externalOrderId:'test',kind:'IMPORTED_ORDER',beforeSnapshot:before,afterSnapshot:after,rollbackEligible:true,rolledBackAt:null};run={id:'run',mode:'APPLY',status:'FAILED',mutations:[mutation],rolledBackAt:null};
 const discountMinor=changedValue?2000:1000,priceMinor=changedValue?8000:9000;
 const command={mode:'FIXED',value:discountMinor},token=compositionToken(await tx.order.findFirst()),previousVersion=root.updatedAt.getTime();
 await applyOrderDiscount(tx,root.id,command,token,'discount-same-key-123','owner');
 rollbackWrites=0;
 await assert.rejects(service.rollback('run',{id:'owner'}),/изменён после импорта/);
 assert.equal(root.discountMinor,discountMinor);assert.equal(root.priceMinor,priceMinor);assert.equal(rollbackWrites,0);if(!changedValue)assert.ok(root.updatedAt.getTime()>previousVersion);assert.equal(activities.filter(a=>a.type==='ORDER_DISCOUNT_UPDATED').length,1);
 const savedVersion=root.updatedAt.getTime();await applyOrderDiscount(tx,root.id,command,token,'discount-same-key-123','owner');assert.equal(root.updatedAt.getTime(),savedVersion);assert.equal(activities.length,1);
});

test('KeyCRM shipment sync advances a future parcel version monotonically', async () => {
  const previous = new Date('2099-01-01T00:00:00.000Z');
  const f = shipmentCurrencyImportFixture({ updatedAt: previous });
  await f.service.importOrder(f.incoming, 'owner', 'run-1');
  assert.ok(f.shipment.updatedAt.getTime() > previous.getTime());
  assert.equal(f.writes[0].updatedAt.getTime(), previous.getTime() + 1);
});
for(const state of ['new','historical-active','restored','manual-link'])test(`tax first-capture eligibility for KeyCRM ${state}`,async()=>{
 const KeycrmService=loadKeycrmService();
 let orderRow={id:'order-1',number:'KC-14',clientId:'client-1',sourceLinkMode:state==='manual-link'?'MATCHED_EXISTING':'IMPORTED',sourceSystem:'KEYCRM',currency:'EUR',externalUpdatedAt:new Date('2026-10-01T00:00:00Z'),depositRequiredMinor:5000,priceMinor:10000,type:OrderType.CUSTOM_ORDER,paymentStatus:'PARTIALLY_PAID',productionStatus:'NOT_SCHEDULED'};
 let receipt=state==='new'?null:{id:'payment-8',orderId:'order-1',sourceSystem:state==='manual-link'?null:'KEYCRM',sourceAccount:state==='manual-link'?null:'connection-1',externalId:state==='manual-link'?null:'8',amountMinor:5000,currency:'EUR',receivedAt:new Date('2026-05-01T10:00:00Z'),voidedAt:state==='restored'?new Date('2026-10-01T00:00:00Z'):null};
 const hooks=[];
 const tx={$executeRaw:async()=>{},$executeRawUnsafe:async()=>{},$queryRaw:async()=>[],order:{findUnique:async()=>orderRow,update:async({data})=>(orderRow={...orderRow,...data})},clientMergeRedirect:{findUnique:async()=>null},client:{findUniqueOrThrow:async()=>({id:'client-1',email:null,phone:null,country:null,city:null,address:null,postalCode:null}),update:async({data})=>({id:'client-1',...data})},keycrmClientLink:{findUnique:async()=>null},orderItem:{count:async()=>0},orderItemInstance:{findMany:async()=>[]},payment:{findUnique:async()=>state==='manual-link'&&!receipt?.externalId?null:receipt,update:async({data})=>(receipt={...receipt,...data}),findMany:async()=>receipt&&!receipt.voidedAt?[receipt]:[],upsert:async({create,update})=>(receipt=receipt?{...receipt,...update}:{id:'new-receipt',...create})},productionSlot:{findUnique:async()=>null},shipment:{findUnique:async()=>null},activity:{findFirst:async()=>null,create:async()=>{}},auditLog:{create:async()=>{}},keycrmSyncIssue:{findFirst:async()=>null,create:async()=>{}}};
 const service=new KeycrmService({$transaction:fn=>fn(tx)},{capturePayment:async(...args)=>hooks.push(args)});
 await service.importOrder(normalizedOrder({externalId:'14',payments:[{externalId:'8',amountMinor:5000,currency:'EUR',isPaid:true,receivedAt:new Date('2026-05-01T10:00:00Z'),method:'OTHER',externalStatus:'paid'}]}),'owner-1','run-1');
 assert.equal(hooks.length,state==='manual-link'?2:1);assert.ok(hooks.every(h=>h[0]===tx&&h[1]===receipt.id));assert.ok(hooks.every(h=>h[4].createIfMissing===!['historical-active','manual-link'].includes(state)));if(state==='manual-link')assert.equal(receipt.id,'payment-8');
});

test('tax hooks reconcile matched-existing rollback and reapply without first-capturing unrelated manual history',async()=>{
 const hooks=[],f=localCompositionImportFixture({taxes:{capturePayment:async(...args)=>hooks.push(args)}});
 const oldManual={id:'untouched-manual',orderId:'order-1',amountMinor:5000,currency:'EUR',receivedAt:new Date('2026-05-01'),voidedAt:null,sourceSystem:null};
 const provider={id:'restored-provider',orderId:'order-1',amountMinor:5000,currency:'EUR',receivedAt:new Date('2026-05-01'),voidedAt:new Date('2026-10-01'),sourceSystem:'KEYCRM',sourceAccount:'connection-1',externalId:'provider-pay'};
 f.state.payments=[oldManual,provider];
 f.tx.order.findUnique=async()=>structuredClone({...f.state.order,items:f.state.items,payments:f.state.payments,productionSlot:null,shipment:null,invoices:f.state.invoices,expenses:[],agreements:[]});
 f.tx.orderItem.update=async({where,data})=>{const row=f.state.items.find(x=>x.id===where.id);Object.assign(row,data);return structuredClone(row)};
 f.tx.payment.findUnique=async()=>structuredClone(provider);
 f.tx.payment.upsert=async({update})=>{Object.assign(provider,update);return structuredClone(provider)};
 f.tx.payment.update=async({where,data})=>{const row=f.state.payments.find(x=>x.id===where.id);Object.assign(row,data);return structuredClone(row)};
 const run=captureShipmentMutation(f),incoming=normalizedOrder({payments:[{externalId:'provider-pay',amountMinor:5000,currency:'EUR',receivedAt:new Date('2026-05-01'),isPaid:true,method:'OTHER',externalStatus:'paid'}]});
 await f.service.importOrder(incoming,'owner','run-1');assert.equal(hooks.at(-1)[2],'IMPORT_RESTORE');assert.equal(hooks.at(-1)[4].createIfMissing,true);
 await f.service.rollback('run-1',{id:'owner'});
 const compensation=hooks.filter(h=>h[2].startsWith('ROLLBACK:'));assert.deepEqual(compensation.map(h=>h[1]).sort(),['restored-provider','untouched-manual']);assert.ok(compensation.every(h=>h[4].createIfMissing===false));assert.ok(provider.voidedAt);
 await f.service.importOrder(incoming,'owner','run-2');assert.equal(hooks.at(-1)[2],'IMPORT_RESTORE');assert.equal(provider.voidedAt,null);
});
