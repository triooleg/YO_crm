import assert from "node:assert/strict";
import test from "node:test";
import {
  ORDER_MODEL_IMAGE_ERROR,
  OrderModelImageOperationError,
  persistOrderModelImage,
} from "../src/orders/order-model-image.ts";

function transactionFixture({ items = [{ id: "item-1", modelImagePath: "old.jpg", createdAt: new Date("2026-01-01") }, { id: "item-2", modelImagePath: "second.jpg", createdAt: new Date("2026-01-02") }], missing = false, failAt } = {}) {
  const state = { order: { id: "order-1", clientId: "client-1", modelImagePath: "old.jpg", archivedAt: null, items }, activities: [], audits: [] };
  const transaction = async (callback) => {
    const draft = structuredClone(state);
    const tx = {
      $executeRawUnsafe: async () => undefined,
      order: {
        findFirst: async () => missing ? null : structuredClone(draft.order),
        update: async ({ data }) => { draft.order = { ...draft.order, ...data }; return structuredClone(draft.order); },
      },
      orderItem: {
        update: async ({ where, data }) => {
          const index = draft.order.items.findIndex((item) => item.id === where.id);
          draft.order.items[index] = { ...draft.order.items[index], ...data };
          return structuredClone(draft.order.items[index]);
        },
      },
      activity: { create: async ({ data }) => { if (failAt === "activity") throw new Error("activity failed"); draft.activities.push(data); } },
      auditLog: { create: async ({ data }) => { if (failAt === "audit") throw new Error("audit failed"); draft.audits.push(data); } },
    };
    const result = await callback(tx);
    Object.assign(state, draft);
    return result;
  };
  return { state, transaction };
}

test("замена изображения первой позиции синхронизирует главное изображение заказа и историю", async () => {
  const fixture = transactionFixture();
  await fixture.transaction((tx) => persistOrderModelImage(tx, "order-1", { itemId: "item-1", modelImagePath: "new.jpg", expectedModelImagePath: "old.jpg" }, "owner-1"));
  assert.equal(fixture.state.order.items[0].modelImagePath, "new.jpg");
  assert.equal(fixture.state.order.modelImagePath, "new.jpg");
  assert.equal(fixture.state.activities.length, 1);
  assert.deepEqual(fixture.state.audits.map((entry) => entry.entityType), ["OrderItem", "Order"]);
});

test("замена изображения второй позиции не меняет главное изображение заказа", async () => {
  const fixture = transactionFixture();
  await fixture.transaction((tx) => persistOrderModelImage(tx, "order-1", { itemId: "item-2", modelImagePath: "new.jpg", expectedModelImagePath: "second.jpg" }, "owner-1"));
  assert.equal(fixture.state.order.items[1].modelImagePath, "new.jpg");
  assert.equal(fixture.state.order.modelImagePath, "old.jpg");
  assert.deepEqual(fixture.state.audits.map((entry) => entry.entityType), ["OrderItem"]);
});

test("заказ без позиций сохраняет новое главное изображение", async () => {
  const fixture = transactionFixture({ items: [] });
  await fixture.transaction((tx) => persistOrderModelImage(tx, "order-1", { modelImagePath: "new.jpg", expectedModelImagePath: "old.jpg" }, "owner-1"));
  assert.equal(fixture.state.order.modelImagePath, "new.jpg");
  assert.equal(fixture.state.audits[0].entityType, "Order");
});

test("чужая позиция и отсутствующий заказ отклоняются без записей", async () => {
  const fixture = transactionFixture();
  await assert.rejects(() => fixture.transaction((tx) => persistOrderModelImage(tx, "order-1", { itemId: "other", modelImagePath: "new.jpg", expectedModelImagePath: null }, "owner-1")), (error) => error instanceof OrderModelImageOperationError && error.code === ORDER_MODEL_IMAGE_ERROR.itemNotFound);
  assert.equal(fixture.state.activities.length, 0);
  assert.equal(fixture.state.audits.length, 0);

  const missing = transactionFixture({ missing: true });
  await assert.rejects(() => missing.transaction((tx) => persistOrderModelImage(tx, "order-1", { modelImagePath: "new.jpg", expectedModelImagePath: null }, "owner-1")), (error) => error instanceof OrderModelImageOperationError && error.code === ORDER_MODEL_IMAGE_ERROR.orderNotFound);
});

test("устаревшее исходное изображение не перезаписывает более новое", async () => {
  const fixture = transactionFixture();
  await assert.rejects(() => fixture.transaction((tx) => persistOrderModelImage(tx, "order-1", { itemId: "item-1", modelImagePath: "new.jpg", expectedModelImagePath: "stale.jpg" }, "owner-1")), (error) => error instanceof OrderModelImageOperationError && error.code === ORDER_MODEL_IMAGE_ERROR.changed);
  assert.equal(fixture.state.order.items[0].modelImagePath, "old.jpg");
  assert.equal(fixture.state.activities.length, 0);
});

test("отсутствующее исходное изображение не обходит защиту конкурентной замены", async () => {
  const fixture = transactionFixture();
  await assert.rejects(() => fixture.transaction((tx) => persistOrderModelImage(tx, "order-1", { itemId: "item-1", modelImagePath: "new.jpg" }, "owner-1")), (error) => error instanceof OrderModelImageOperationError && error.code === ORDER_MODEL_IMAGE_ERROR.changed);
  assert.equal(fixture.state.order.items[0].modelImagePath, "old.jpg");
});

for (const failAt of ["activity", "audit"]) test(`ошибка ${failAt} откатывает изображение вместе с историей`, async () => {
  const fixture = transactionFixture({ failAt });
  const before = structuredClone(fixture.state);
  await assert.rejects(() => fixture.transaction((tx) => persistOrderModelImage(tx, "order-1", { itemId: "item-1", modelImagePath: "new.jpg", expectedModelImagePath: "old.jpg" }, "owner-1")), new RegExp(`${failAt} failed`));
  assert.deepEqual(fixture.state, before);
});
