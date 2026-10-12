import assert from "node:assert/strict";
import test from "node:test";
import { ORDER_ITEM_DETAILS_ERROR, OrderItemDetailsError, persistAddedOrderItem, persistOrderItemDetails } from "../src/orders/order-item-details.ts";

function fixture({ productionSlot = null } = {}) {
  const state = {
    order: {
      id: "order-1", clientId: "client-1", currency: "EUR", type: "CUSTOM_ORDER", productionStatus: "NOT_SCHEDULED", archivedAt: null,
      priceMinor: 30000, depositRequiredMinor: 15000, paymentStatus: "UNPAID", modelImagePath: "first.jpg",
      items: [
        { id: "item-1", name: "Первый", quantity: 1, priceMinor: 10000, modelImagePath: "first.jpg", designNumber: 17, createdAt: new Date("2026-01-01") },
        { id: "item-2", name: "Второй", quantity: 2, priceMinor: 10000, modelImagePath: "second.jpg", designNumber: null, createdAt: new Date("2026-01-02") },
      ],
      payments: [], productionSlot,
    },
    activities: [], audits: [],
  };
  const tx = {
    $executeRawUnsafe: async () => undefined,
    order: {
      findFirst: async () => structuredClone(state.order),
      update: async ({ data }) => { state.order = { ...state.order, ...data }; return structuredClone(state.order); },
    },
    orderItem: {
      create: async ({ data }) => { const item={ id:`item-${state.order.items.length+1}`,createdAt:new Date(),productionStatus:"NOT_SCHEDULED",...data };state.order.items.push(item);return structuredClone(item); },
      update: async ({ where, data }) => {
        const index = state.order.items.findIndex((item) => item.id === where.id);
        state.order.items[index] = { ...state.order.items[index], ...data };
        return structuredClone(state.order.items[index]);
      },
    },
    productionSlot: {
      update: async ({ data }) => { state.order.productionSlot = { ...state.order.productionSlot, ...data }; return structuredClone(state.order.productionSlot); },
    },
    athlete: { findFirst: async ({where}) => where.id === "athlete-1" && where.clientId === state.order.clientId ? {id:where.id} : null },
    activity: { create: async ({ data }) => state.activities.push(data) },
    auditLog: { create: async ({ data }) => state.audits.push(data) },
  };
  return { state, tx };
}

test("исторический слот быстрой продажи не блокирует изменение дизайна", async () => {
  const { state, tx } = fixture({ productionSlot: { id: "slot-1", tentative: false } });
  state.order.type = "WEBSITE_SALE";
  await persistOrderItemDetails(tx, "order-1", "item-2", { ...expectedSecond, name: "Продано с сайта", quantity: 3, priceMinor: 12000 }, "owner-1");
  assert.equal(state.order.priceMinor, 46000);
});

test("снижение цены дизайна подтверждает предварительный слот при достаточной предоплате", async () => {
  const { state, tx } = fixture({ productionSlot: { id: "slot-1", tentative: true } });
  state.order.payments = [{ amountMinor: 10000, currency: "EUR" }];
  await persistOrderItemDetails(tx, "order-1", "item-2", { ...expectedSecond, name: "Второй", quantity: 1, priceMinor: 5000 }, "owner-1");
  assert.equal(state.order.productionSlot.tentative, false);
  assert.equal(state.order.productionStatus, "SCHEDULED");
  assert.deepEqual(state.activities.map(activity=>activity.type), ["PRODUCTION_SLOT_CONFIRMED","ORDER_ITEM_DETAILS_UPDATED"]);
});

const expectedSecond = { expectedName: "Второй", expectedQuantity: 2, expectedPriceMinor: 10000, expectedModelImagePath: "second.jpg", expectedDesignNumber: null };

test("редактирование конкретного дизайна пересчитывает итог и предоплату заказа", async () => {
  const { state, tx } = fixture();
  await persistOrderItemDetails(tx, "order-1", "item-2", { ...expectedSecond, name: "Второй новый", quantity: 3, priceMinor: 12000 }, "owner-1");
  assert.equal(state.order.items[1].name, "Второй новый");
  assert.equal(state.order.items[1].quantity, 3);
  assert.equal(state.order.priceMinor, 46000);
  assert.equal(state.order.depositRequiredMinor, 23000);
  assert.equal(state.activities[0].type, "ORDER_ITEM_DETAILS_UPDATED");
  assert.deepEqual(state.audits.map((audit) => audit.entityType), ["OrderItem", "Order"]);
});

test("изображение первого дизайна синхронизируется с главным изображением заказа", async () => {
  const { state, tx } = fixture();
  await persistOrderItemDetails(tx, "order-1", "item-1", { name: "Первый", quantity: 1, priceMinor: 10000, expectedName: "Первый", expectedQuantity: 1, expectedPriceMinor: 10000, expectedModelImagePath: "first.jpg", modelImagePath: "new-first.jpg" }, "owner-1");
  assert.equal(state.order.items[0].modelImagePath, "new-first.jpg");
  assert.equal(state.order.modelImagePath, "new-first.jpg");
  assert.equal(state.order.items[1].modelImagePath, "second.jpg");
});

test("номер файла Adobe Illustrator сохраняется у выбранного дизайна", async () => {
  const { state, tx } = fixture();
  await persistOrderItemDetails(tx, "order-1", "item-2", { ...expectedSecond, name: "Второй", quantity: 2, priceMinor: 10000, designNumber: 428 }, "owner-1");
  assert.equal(state.order.items[1].designNumber, 428);
  assert.equal(state.order.items[0].designNumber, 17);
});

test("номер файла Adobe Illustrator нельзя перезаписать без ожидаемой версии", async () => {
  const { state, tx } = fixture();
  await assert.rejects(() => persistOrderItemDetails(tx, "order-1", "item-2", { expectedName: "Второй", expectedQuantity: 2, expectedPriceMinor: 10000, expectedModelImagePath: "second.jpg", name: "Второй", quantity: 2, priceMinor: 10000, designNumber: 429 }, "owner-1"), (error) => error instanceof OrderItemDetailsError && error.code === ORDER_ITEM_DETAILS_ERROR.changed);
  assert.equal(state.order.items[1].designNumber, null);
});

test("устаревшие данные позиции блокируют параллельную правку", async () => {
  const { state, tx } = fixture();
  await assert.rejects(() => persistOrderItemDetails(tx, "order-1", "item-2", { ...expectedSecond, expectedPriceMinor: 9000, name: "Чужая правка", quantity: 2, priceMinor: 10000 }, "owner-1"), (error) => error instanceof OrderItemDetailsError && error.code === ORDER_ITEM_DETAILS_ERROR.changed);
  assert.equal(state.order.items[1].name, "Второй");
});

test("подтверждённый слот защищён от повышения требуемой предоплаты", async () => {
  const { tx } = fixture({ productionSlot: { id: "slot-1", tentative: false } });
  await assert.rejects(() => persistOrderItemDetails(tx, "order-1", "item-2", { ...expectedSecond, name: "Дороже", quantity: 3, priceMinor: 12000 }, "owner-1"), (error) => error instanceof OrderItemDetailsError && error.code === ORDER_ITEM_DETAILS_ERROR.depositWouldUnconfirmProduction);
});

test("новый дизайн становится позицией заказа и пересчитывает итог",async()=>{
  const{state,tx}=fixture();
  const item=await persistAddedOrderItem(tx,"order-1",{name:"Третий",quantity:2,priceMinor:5000,designNumber:501,athleteId:"athlete-1",modelImagePath:"third.jpg"},"owner-1");
  assert.equal(item.designNumber,501);
  assert.equal(item.athleteId,"athlete-1");
  assert.equal(item.modelImagePath,"third.jpg");
  assert.equal(state.order.priceMinor,40000);
  assert.equal(state.order.depositRequiredMinor,20000);
  assert.deepEqual(state.audits.map(audit=>audit.entityType),["OrderItem","Order"]);
  const reloaded=state.order.items.find(candidate=>candidate.id===item.id);
  assert.equal(reloaded.designNumber,501);
  assert.equal(reloaded.athleteId,"athlete-1");
  assert.equal(reloaded.modelImagePath,"third.jpg");
});

test("первый платный дизайн устанавливает стандартную предоплату и может получить спортсмена клиента",async()=>{
  const{state,tx}=fixture();
  state.order.priceMinor=0;state.order.depositRequiredMinor=0;state.order.items=[];
  const item=await persistAddedOrderItem(tx,"order-1",{name:"Первый дизайн",quantity:1,priceMinor:40000,athleteId:"athlete-1"},"owner-1");
  assert.equal(item.athleteId,"athlete-1");
  assert.equal(state.order.depositRequiredMinor,20000);
});

test("сервер отклоняет пустое имя и чужого спортсмена нового дизайна",async()=>{
  const{tx}=fixture();
  await assert.rejects(()=>persistAddedOrderItem(tx,"order-1",{name:"   ",quantity:1,priceMinor:1000},"owner-1"),error=>error instanceof OrderItemDetailsError&&error.code===ORDER_ITEM_DETAILS_ERROR.changed);
  await assert.rejects(()=>persistAddedOrderItem(tx,"order-1",{name:"Дизайн",quantity:1,priceMinor:1000,athleteId:"foreign"},"owner-1"),error=>error instanceof OrderItemDetailsError&&error.code===ORDER_ITEM_DETAILS_ERROR.athleteNotFound);
});
