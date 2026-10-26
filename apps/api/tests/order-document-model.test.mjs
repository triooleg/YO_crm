import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const source = await readFile(new URL("../src/finance/order-document-model.ts", import.meta.url), "utf8").catch(() => "");

function load() {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require: createRequire(import.meta.url), Intl, Date, structuredClone });
  return module.exports;
}

test("каталог документов публикует только разрешённые клиентские поля", () => {
  const { orderDocumentFieldDefinitions } = load();
  const keys = orderDocumentFieldDefinitions().map(item => item.key);
  assert.ok(keys.includes("order.number"));
  assert.ok(keys.includes("client.name"));
  assert.ok(keys.includes("delivery.address"));
  assert.ok(keys.includes("finance.balance"));
  assert.ok(keys.includes("table.items"));
  assert.ok(keys.includes("table.payments"));
  assert.ok(!keys.some(key => /externalData|audit|token|secret/i.test(key)));
});

test("выбор полей удаляет неизвестные ключи и дубликаты", () => {
  const { normalizeDocumentFieldKeys } = load();
  assert.deepEqual(Array.from(normalizeDocumentFieldKeys(["order.number", "secret.token", "order.number", "client.email"])), ["order.number", "client.email"]);
});

test("снимок документа сохраняет minor units и выбранные таблицы", () => {
  const { buildOrderDocumentSnapshot } = load();
  const snapshot = buildOrderDocumentSnapshot({
    id: "order-1", number: "YO-684", currency: "EUR", priceMinor: 33000, deliveryMinor: 3000, discountMinor: 0, taxMinor: 0, giftWrapMinor: 0,
    createdAt: new Date("2026-10-23T10:00:00Z"), requiredDeliveryAt: null, type: "CUSTOM", discipline: "RHYTHMIC_GYMNASTICS", salesStatus: "NEW_ORDER", productionStatus: "NOT_SCHEDULED", paymentStatus: "PARTIAL", shippingStatus: "NOT_READY",
    notes: "Client-visible note", buyerComment: "Please use blue", promocode: null,
    client: { displayName: "Client Name", email: "client@example.test", phone: "+100000000", country: "France", city: "Paris", address: "1 Test Street", postalCode: "75001", language: "fr" },
    athlete: { firstName: "Anna", lastName: "Test" },
    items: [{ name: "Custom leotard", quantity: 1, priceMinor: 30000, sku: "SKU-1", designNumber: 7 }],
    payments: [{ amountMinor: 16500, currency: "EUR", receivedAt: new Date("2026-10-23T12:00:00Z"), method: "BANK_TRANSFER", reference: "PART-1" }],
    deliveryRecipient: "Client Name", deliveryRecipientPhone: "+100000000", deliveryEmail: "client@example.test", deliveryAddressText: "1 Test Street, Paris", deliveryServiceName: "DHL", deliveryTrackingCode: null,
    depositRequiredMinor: 16500
  }, ["order.number", "finance.total", "finance.paid", "finance.balance", "table.items", "table.payments"]);
  assert.equal(snapshot.currency, "EUR");
  assert.equal(snapshot.values["finance.total"].minor, 33000);
  assert.equal(snapshot.values["finance.paid"].minor, 16500);
  assert.equal(snapshot.values["finance.balance"].minor, 16500);
  assert.equal(snapshot.items[0].amountMinor, 30000);
  assert.equal(snapshot.payments[0].amountMinor, 16500);
  assert.equal(snapshot.values["client.email"], undefined);
});

test("редактирование черновика обновляет снимок без потери выбранных полей", () => {
  const { updateInvoiceSnapshot } = load();
  const updated = updateInvoiceSnapshot({ version: 1, orderId: "order-1", orderNumber: "YO-684", currency: "EUR", fieldKeys: ["client.name", "client.address", "table.items"], values: { "client.name": "Old", "client.address": "Old address" }, items: [], payments: [] }, [{ description: "Custom leotard", quantity: 2, amountMinor: 19000 }], { name: "New client", address: "New address" });
  assert.equal(updated.values["client.name"], "New client");
  assert.equal(updated.values["client.address"], "New address");
  assert.equal(updated.items[0].quantity, 2);
  assert.equal(updated.items[0].amountMinor, 19000);
  assert.deepEqual(Array.from(updated.fieldKeys), ["client.name", "client.address", "table.items"]);
});

test("строки инвойса пересчитывают выбранные итоги и не возвращают отключённую таблицу", () => {
  const { mergeInvoiceItems } = load();
  const base = { version: 1, orderId: "order-1", orderNumber: "YO-684", currency: "EUR", fieldKeys: ["finance.itemsTotal", "finance.total"], values: { "finance.itemsTotal": { minor: 33000, currency: "EUR" }, "finance.total": { minor: 33000, currency: "EUR" } }, items: [], payments: [] };
  const updated = mergeInvoiceItems(base, [{ description: "Custom leotard", quantity: 2, amountMinor: 19000 }]);
  assert.equal(updated.values["finance.itemsTotal"].minor, 38000);
  assert.equal(updated.values["finance.total"].minor, 38000);
  assert.deepEqual(Array.from(updated.items), []);
});

test("снимок использует зафиксированную сумму оплаты в валюте заказа", () => {
  const { buildOrderDocumentSnapshot } = load();
  const snapshot = buildOrderDocumentSnapshot({ id: "order-2", number: "YO-700", currency: "EUR", priceMinor: 40000, createdAt: "2026-10-23T10:00:00Z", client: { displayName: "Client" }, payments: [{ amountMinor: 18000, currency: "USD", appliedAmountMinor: 16500, appliedCurrency: "EUR", receivedAt: "2026-10-23T12:00:00Z", method: "BANK_TRANSFER" }] }, ["finance.paid", "finance.balance"]);
  assert.equal(snapshot.values["finance.paid"].minor, 16500);
  assert.equal(snapshot.values["finance.balance"].minor, 23500);
});

test("данные клиента не добавляются поверх отключённых полей", () => {
  const { updateInvoiceSnapshot } = load();
  const snapshot = { version: 1, orderId: "order-3", orderNumber: "YO-701", currency: "EUR", fieldKeys: ["order.number"], values: { "order.number": "YO-701" }, items: [], payments: [] };
  const updated = updateInvoiceSnapshot(snapshot, undefined, { name: "Hidden", address: "Hidden address" });
  assert.equal(updated.values["client.name"], undefined);
  assert.equal(updated.values["client.address"], undefined);
});

test("редактирование строки сохраняет свойства исходной позиции", () => {
  const { mergeInvoiceItems } = load();
  const snapshot = { version: 1, orderId: "order-4", orderNumber: "YO-702", currency: "EUR", fieldKeys: ["table.items", "finance.total"], values: { "finance.total": { minor: 40000, currency: "EUR" } }, items: [{ description: "Leotard", quantity: 1, amountMinor: 40000, properties: ["Height: 150-155", "Color: blue"] }], payments: [] };
  const updated = mergeInvoiceItems(snapshot, [{ description: "Custom leotard", quantity: 1, amountMinor: 40000 }]);
  assert.deepEqual(Array.from(updated.items[0].properties), ["Height: 150-155", "Color: blue"]);
});
