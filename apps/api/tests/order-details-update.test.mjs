import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/orders/order-details.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const detailsModule = { exports: {} };
const paymentStatus = { UNPAID: "UNPAID", PARTIALLY_PAID: "PARTIALLY_PAID", DEPOSIT_PAID: "DEPOSIT_PAID", PAID: "PAID", REFUNDED: "REFUNDED", CANCELLED: "CANCELLED" };
const productionStatus = { NOT_SCHEDULED: "NOT_SCHEDULED", SCHEDULED: "SCHEDULED" };
const requiresProduction = type => !["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"].includes(type);
vm.runInNewContext(javascript, { module: detailsModule, exports: detailsModule.exports, require: specifier => specifier === "@prisma/client" ? { OrderType: {}, PaymentStatus: paymentStatus, ProductionStatus: productionStatus } : specifier === "./production-rules" ? { DEFAULT_SHIPPING_LEAD_DAYS: 7, productionSetting: (value, fallback) => Number.isInteger(value) ? value : fallback, requiresProduction, violatesShippingLead: () => false } : undefined, BigInt, Date, Math });
const { ORDER_DETAILS_ERROR, OrderDetailsOperationError, persistOrderDetails } = detailsModule.exports;

const expected = { expectedDescription: "Старое описание", expectedPriceMinor: 20000, expectedModelImagePath: "old.jpg" };

function fixture({
  items = [{ id: "item-1", name: "Старое описание", quantity: 1, priceMinor: 20000, modelImagePath: "old.jpg", createdAt: new Date("2026-01-01") }],
  order: overrides = {},
  failAudit = false,
} = {}) {
  const state = { order: { id: "order-1", clientId: "client-1", type: "CUSTOM_ORDER", notes: "Старое описание", priceMinor: 20000, depositRequiredMinor: 10000, currency: "EUR", paymentStatus: "UNPAID", productionStatus: "NOT_SCHEDULED", modelImagePath: "old.jpg", archivedAt: null, items, payments: [], productionSlot: null, ...overrides }, activities: [], audits: [] };
  const transaction = async (callback) => {
    const draft = structuredClone(state);
    const tx = {
      $executeRawUnsafe: async () => undefined,
      order: {
        findFirst: async () => draft.order?.archivedAt ? null : structuredClone(draft.order),
        update: async ({ data }) => { draft.order = { ...draft.order, ...data }; return structuredClone(draft.order); },
      },
      orderItem: { update: async ({ where, data }) => { const index = draft.order.items.findIndex((item) => item.id === where.id); draft.order.items[index] = { ...draft.order.items[index], ...data }; return structuredClone(draft.order.items[index]); } },
      productionSlot: {
        update: async ({ data }) => { draft.order.productionSlot = { ...draft.order.productionSlot, ...data }; return structuredClone(draft.order.productionSlot); },
        delete: async () => { const deleted = structuredClone(draft.order.productionSlot); draft.order.productionSlot = null; return deleted; },
      },
      appSetting: { findUnique: async () => null },
      activity: { create: async ({ data }) => draft.activities.push(data) },
      auditLog: { create: async ({ data }) => { if (failAudit) throw new Error("audit unavailable"); draft.audits.push(data); } },
    };
    const result = await callback(tx); Object.assign(state, draft); return result;
  };
  return { state, transaction };
}

test("описание одиночного заказа синхронизируется с позицией, а общая цена не подменяет цену позиции", async () => {
  const testState = fixture();
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Новое описание", priceMinor: 30000 }, "owner-1"));
  assert.equal(testState.state.order.notes, "Новое описание");
  assert.equal(testState.state.order.priceMinor, 30000);
  assert.equal(testState.state.order.depositRequiredMinor, 15000);
  assert.equal(testState.state.order.items[0].name, "Новое описание");
  assert.equal(testState.state.order.items[0].priceMinor, 20000);
  assert.equal(testState.state.activities.length, 1);
  assert.deepEqual(testState.state.audits.map((audit) => audit.entityType), ["OrderItem", "Order"]);
});

test("общая цена с дополнительными суммами не подменяет цену единственной позиции", async () => {
  const testState = fixture({ items: [{ id: "item-1", name: "Модель", quantity: 1, priceMinor: 20000, modelImagePath: "old.jpg", createdAt: new Date("2026-01-01") }] });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Модель и доставка", priceMinor: 23000 }, "owner-1"));
  assert.equal(testState.state.order.priceMinor, 23000);
  assert.equal(testState.state.order.items[0].priceMinor, 20000);
});

test("главное изображение обновляет первую позицию, не удаляя остальные", async () => {
  const testState = fixture({ items: [
    { id: "item-1", name: "Первый", quantity: 1, priceMinor: 10000, modelImagePath: "old.jpg", createdAt: new Date("2026-01-01") },
    { id: "item-2", name: "Второй", quantity: 1, priceMinor: 10000, modelImagePath: "second.jpg", createdAt: new Date("2026-01-02") },
  ] });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Заказ", priceMinor: 22000, modelImagePath: "new.jpg", expectedModelImagePath: "old.jpg" }, "owner-1"));
  assert.equal(testState.state.order.modelImagePath, "new.jpg");
  assert.equal(testState.state.order.items[0].modelImagePath, "new.jpg");
  assert.equal(testState.state.order.items[1].modelImagePath, "second.jpg");
  assert.equal(testState.state.order.items[0].name, "Первый");
  assert.equal(testState.state.order.items[0].priceMinor, 10000);
});

test("общая цена заказа не подменяет цену единицы позиции с количеством больше одного", async () => {
  const testState = fixture({ items: [{ id: "item-1", name: "Модель", quantity: 3, priceMinor: 10000, modelImagePath: "old.jpg", createdAt: new Date("2026-01-01") }] });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Три костюма", priceMinor: 36000 }, "owner-1"));
  assert.equal(testState.state.order.items[0].name, "Три костюма");
  assert.equal(testState.state.order.items[0].priceMinor, 10000);
});

for (const [paidMinor, status] of [[0, "UNPAID"], [5000, "PARTIALLY_PAID"], [10000, "DEPOSIT_PAID"], [20000, "PAID"]]) {
  test(`платёжный статус пересчитывается по подтверждённым платежам: ${status}`, async () => {
    const payments = paidMinor ? [{ amountMinor: paidMinor, currency: "EUR", appliedAmountMinor: null, appliedCurrency: null }] : [];
    const testState = fixture({ order: { payments } });
    await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Без изменения цены", priceMinor: 20000 }, "owner-1"));
    assert.equal(testState.state.order.paymentStatus, status);
  });
}

test("платёж в другой валюте без применённой суммы не влияет на статус", async () => {
  const testState = fixture({ order: { payments: [{ amountMinor: 20000, currency: "USD", appliedAmountMinor: null, appliedCurrency: null }] } });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Заказ", priceMinor: 20000 }, "owner-1"));
  assert.equal(testState.state.order.paymentStatus, "UNPAID");
});

test("достаточная предоплата подтверждает tentative-слот и создаёт отдельное событие", async () => {
  const testState = fixture({ order: { payments: [{ amountMinor: 10000, currency: "EUR" }], productionSlot: { id: "slot-1", tentative: true } } });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Заказ", priceMinor: 20000 }, "owner-1"));
  assert.equal(testState.state.order.productionSlot.tentative, false);
  assert.deepEqual(testState.state.activities.map((activity) => activity.type), ["PRODUCTION_SLOT_CONFIRMED", "ORDER_DETAILS_UPDATED"]);
});

test("изменение быстрой продажи не подтверждает исторический производственный слот", async () => {
  const testState = fixture({ order: { type: "READY_MODEL", depositRequiredMinor: 0, payments: [{ amountMinor: 20000, currency: "EUR" }], productionSlot: { id: "slot-1", tentative: true } } });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Готовая модель", priceMinor: 20000 }, "owner-1"));
  assert.equal(testState.state.order.productionSlot.tentative, true);
  assert.equal(testState.state.order.productionStatus, "NOT_SCHEDULED");
  assert.deepEqual(testState.state.activities.map((activity) => activity.type), ["ORDER_DETAILS_UPDATED"]);
});

for (const type of ["WEBSITE_SALE", "STOCK_SALE"]) {
  test(`тип ${type} удаляет производственный слот и исключает заказ из планирования`, async () => {
    const testState = fixture({ order: { productionStatus: "SCHEDULED", productionSlot: { id: "slot-1", tentative: false, startsAt: new Date("2026-10-01"), endsAt: new Date("2026-10-07") } } });
    await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Быстрая продажа", priceMinor: 20000, type, expectedType: "CUSTOM_ORDER" }, "owner-1"));
    assert.equal(testState.state.order.type, type);
    assert.equal(testState.state.order.productionStatus, "NOT_SCHEDULED");
    assert.equal(testState.state.order.productionSlot, null);
    assert.deepEqual(testState.state.activities.map((activity) => activity.type), ["PRODUCTION_SLOT_DELETED", "ORDER_DETAILS_UPDATED"]);
  });
}

test("переход быстрой продажи в производство восстанавливает предоплату до расчёта статуса оплаты", async () => {
  const testState = fixture({ order: { type: "WEBSITE_SALE", depositRequiredMinor: 0, paymentStatus: "DEPOSIT_PAID", payments: [{ amountMinor: 5000, currency: "EUR" }] } });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Индивидуальный заказ", priceMinor: 30000, type: "CUSTOM_ORDER", expectedType: "WEBSITE_SALE" }, "owner-1"));
  assert.equal(testState.state.order.depositRequiredMinor, 15000);
  assert.equal(testState.state.order.paymentStatus, "PARTIALLY_PAID");
});

test("исторически подтверждённый слот не блокирует изменение цены быстрой продажи", async () => {
  const testState = fixture({ order: { type: "READY_MODEL", payments: [{ amountMinor: 10000, currency: "EUR" }], productionSlot: { id: "slot-1", tentative: false } } });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Готовая модель дороже", priceMinor: 30000 }, "owner-1"));
  assert.equal(testState.state.order.priceMinor, 30000);
  assert.equal(testState.state.order.productionSlot.tentative, false);
  assert.deepEqual(testState.state.activities.map((activity) => activity.type), ["ORDER_DETAILS_UPDATED"]);
});

test("нулевая требуемая предоплата без платежа не подтверждает производственный слот", async () => {
  const testState = fixture({ order: { priceMinor: 0, depositRequiredMinor: 0, productionSlot: { id: "slot-1", tentative: true } } });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { expectedDescription: "Старое описание", expectedPriceMinor: 0, expectedModelImagePath: "old.jpg", description: "Бесплатный заказ", priceMinor: 0 }, "owner-1"));
  assert.equal(testState.state.order.productionSlot.tentative, true);
  assert.deepEqual(testState.state.activities.map((activity) => activity.type), ["ORDER_DETAILS_UPDATED"]);
});

test("нельзя увеличить цену так, чтобы подтверждённый слот потерял требуемую предоплату", async () => {
  const testState = fixture({ order: { payments: [{ amountMinor: 10000, currency: "EUR" }], productionSlot: { id: "slot-1", tentative: false } } });
  await assert.rejects(() => testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Дороже", priceMinor: 30000 }, "owner-1")), (error) => error instanceof OrderDetailsOperationError && error.code === ORDER_DETAILS_ERROR.depositWouldUnconfirmProduction);
  assert.equal(testState.state.order.priceMinor, 20000);
  assert.equal(testState.state.activities.length, 0);
});

test("уточнение описания не блокируется исторически подтверждённым слотом", async () => {
  const testState = fixture({ order: { productionSlot: { id: "slot-1", tentative: false } } });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Уточнённое описание", priceMinor: 20000 }, "owner-1"));
  assert.equal(testState.state.order.notes, "Уточнённое описание");
  assert.equal(testState.state.order.productionSlot.tentative, false);
});

for (const terminalStatus of ["REFUNDED", "CANCELLED"]) {
  test(`терминальный платёжный статус ${terminalStatus} не перезаписывается`, async () => {
    const testState = fixture({ order: { paymentStatus: terminalStatus } });
    await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Уточнение", priceMinor: 20000 }, "owner-1"));
    assert.equal(testState.state.order.paymentStatus, terminalStatus);
  });
}

test("терминальный платёжный статус не подтверждает tentative-слот по историческим платежам", async () => {
  const testState = fixture({ order: { paymentStatus: "REFUNDED", payments: [{ amountMinor: 20000, currency: "EUR" }], productionSlot: { id: "slot-1", tentative: true } } });
  await testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Возврат", priceMinor: 20000 }, "owner-1"));
  assert.equal(testState.state.order.productionSlot.tentative, true);
  assert.deepEqual(testState.state.activities.map((activity) => activity.type), ["ORDER_DETAILS_UPDATED"]);
});

test("описание из пробелов отклоняется до записи данных", async () => {
  const testState = fixture();
  await assert.rejects(() => testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "   ", priceMinor: 20000 }, "owner-1")), (error) => error instanceof OrderDetailsOperationError && error.code === ORDER_DETAILS_ERROR.descriptionRequired);
  assert.equal(testState.state.order.notes, "Старое описание");
  assert.equal(testState.state.activities.length, 0);
});

test("устаревшие описание или цена блокируют параллельную правку", async () => {
  const testState = fixture();
  await assert.rejects(() => testState.transaction((tx) => persistOrderDetails(tx, "order-1", { expectedDescription: "Чужое", expectedPriceMinor: 20000, expectedModelImagePath: "old.jpg", description: "Новая", priceMinor: 20000 }, "owner-1")), (error) => error instanceof OrderDetailsOperationError && error.code === ORDER_DETAILS_ERROR.changed);
});

test("тип и срок нельзя изменить без ожидаемого исходного значения", async () => {
  const typeState = fixture();
  await assert.rejects(() => typeState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Заказ", priceMinor: 20000, type: "WEBSITE_SALE" }, "owner-1")), (error) => error instanceof OrderDetailsOperationError && error.code === ORDER_DETAILS_ERROR.changed);
  const deadlineState = fixture();
  await assert.rejects(() => deadlineState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Заказ", priceMinor: 20000, requiredDeliveryAt: "2026-10-20T00:00:00.000Z" }, "owner-1")), (error) => error instanceof OrderDetailsOperationError && error.code === ORDER_DETAILS_ERROR.changed);
});

test("замена главного изображения без исходного значения блокируется", async () => {
  const testState = fixture();
  await assert.rejects(() => testState.transaction((tx) => persistOrderDetails(tx, "order-1", { expectedDescription: "Старое описание", expectedPriceMinor: 20000, description: "Заказ", priceMinor: 20000, modelImagePath: "new.jpg" }, "owner-1")), (error) => error instanceof OrderDetailsOperationError && error.code === ORDER_DETAILS_ERROR.imageChanged);
  assert.equal(testState.state.order.modelImagePath, "old.jpg");
});

test("ошибка аудита откатывает заказ, позицию и историю", async () => {
  const testState = fixture({ failAudit: true });
  await assert.rejects(() => testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Не сохранится", priceMinor: 30000 }, "owner-1")));
  assert.equal(testState.state.order.notes, "Старое описание");
  assert.equal(testState.state.order.priceMinor, 20000);
  assert.equal(testState.state.activities.length, 0);
});

test("архивный заказ не редактируется", async () => {
  const testState = fixture({ order: { archivedAt: new Date("2026-10-10") } });
  await assert.rejects(() => testState.transaction((tx) => persistOrderDetails(tx, "order-1", { ...expected, description: "Новая", priceMinor: 20000 }, "owner-1")), (error) => error instanceof OrderDetailsOperationError && error.code === ORDER_DETAILS_ERROR.orderNotFound);
});
