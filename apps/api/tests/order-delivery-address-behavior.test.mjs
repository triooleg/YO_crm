import assert from "node:assert/strict";
import test from "node:test";
import {
  DELIVERY_ADDRESS_ERROR,
  DeliveryAddressOperationError,
  ORDER_DELIVERY_ADDRESS_ROLES,
  persistOrderDeliveryAddress,
  resolveDeliveryAddress,
  resolveExistingDeliveryAddress,
} from "../src/orders/order-delivery-address.ts";

const makeClient = () => ({ displayName: "Анна Клиент", address: "Крещатик, 1", city: "Киев", postalCode: "01001", country: "Ukraine" });

test("пустой пользовательский адрес и отсутствующий получатель отклоняются стабильными кодами", () => {
  const client = makeClient();
  assert.throws(() => resolveDeliveryAddress({ useClientAddress: false, recipientMatchesClient: true }, client), (error) => error instanceof DeliveryAddressOperationError && error.code === DELIVERY_ADDRESS_ERROR.addressRequired);
  assert.throws(() => resolveDeliveryAddress({ useClientAddress: false, recipientMatchesClient: false, addressLine1: "Rue 1" }, client), (error) => error instanceof DeliveryAddressOperationError && error.code === DELIVERY_ADDRESS_ERROR.recipientRequired);
});

test("адрес клиента без улицы не считается пригодным снимком доставки", () => {
  const client = { ...makeClient(), address: null, city: "Paris", country: "France" };
  assert.throws(() => resolveDeliveryAddress({ useClientAddress: true, recipientMatchesClient: true }, client), (error) => error instanceof DeliveryAddressOperationError && error.code === DELIVERY_ADDRESS_ERROR.addressRequired);
});

test("страна без улицы или явно указанного полного адреса не сохраняется как адрес", () => {
  assert.throws(() => resolveDeliveryAddress({ useClientAddress: false, recipientMatchesClient: true, country: "France" }, makeClient()), (error) => error instanceof DeliveryAddressOperationError && error.code === DELIVERY_ADDRESS_ERROR.addressRequired);
});

test("адрес клиента сохраняется как независимый снимок заказа", () => {
  const client = makeClient();
  const snapshot = resolveDeliveryAddress({ useClientAddress: true, recipientMatchesClient: true }, client);
  client.address = "Новый адрес клиента";
  client.city = "Львов";
  assert.equal(snapshot.deliveryAddressLine1, "Крещатик, 1");
  assert.equal(snapshot.deliveryCity, "Киев");
  assert.equal(snapshot.deliveryAddressText, "Крещатик, 1, Киев, 01001, Ukraine");
});

test("первое изменение аудирует фактически использованный адрес клиента", () => {
  const client = { ...makeClient(), address: "Новый адрес клиента", city: "Львов" };
  const before = resolveExistingDeliveryAddress({ deliveryAddressSet: false, deliveryRecipient: null, deliveryAddressLine1: null, deliveryAddressLine2: null, deliveryCity: null, deliveryRegion: null, deliveryPostalCode: null, country: null, deliveryAddressText: null }, client);
  assert.deepEqual(before, { deliveryAddressSet: false, deliveryRecipient: "Анна Клиент", deliveryAddressLine1: "Новый адрес клиента", deliveryAddressLine2: null, deliveryCity: "Львов", deliveryRegion: null, deliveryPostalCode: "01001", country: "Ukraine", deliveryAddressText: "Новый адрес клиента, Львов, 01001, Ukraine" });
});

test("структурированные поля имеют приоритет над устаревшим полным адресом", () => {
  const address = resolveDeliveryAddress({ useClientAddress: false, recipientMatchesClient: true, addressLine1: "Rue 2", city: "Paris", country: "France", addressText: "Старый адрес, Киев" }, makeClient());
  assert.equal(address.deliveryAddressText, "Rue 2, Paris, France");
});

test("политика изменения адреса разрешает только CRM-роли", () => {
  assert.deepEqual(ORDER_DELIVERY_ADDRESS_ROLES, ["OWNER", "ADMIN", "MANAGER"]);
  assert.equal(ORDER_DELIVERY_ADDRESS_ROLES.includes("PRODUCTION"), false);
});

const makeOrder = () => ({
  id: "order-1", clientId: "client-1", archivedAt: null,
  deliveryAddressSet: false, deliveryRecipient: null, deliveryAddressLine1: null,
  deliveryAddressLine2: null, deliveryCity: null, deliveryRegion: null,
  deliveryPostalCode: null, country: null, deliveryAddressText: null,
  salesStatus: "ORDER_CONFIRMED", productionStatus: "SCHEDULED",
  paymentStatus: "DEPOSIT_PAID", shippingStatus: "NOT_READY",
  measurementId: "measurement-1", productionSlot: { id: "slot-1" },
  payments: [{ id: "payment-1", amountMinor: 10000 }], client: makeClient(),
});

function transactionFixture({ missing = false, failAt, client } = {}) {
  const state = { order: { ...makeOrder(), ...(client ? { client } : {}) }, activities: [], audits: [] };
  const calls = [];
  const transaction = async (callback) => {
    const draft = structuredClone(state);
    const tx = {
      $executeRawUnsafe: async (...args) => { calls.push(["lock", ...args]); },
      order: {
        findFirst: async (args) => { calls.push(["find", args]); return missing ? null : structuredClone(draft.order); },
        update: async ({ data }) => { calls.push(["update", data]); draft.order = { ...draft.order, ...data }; return structuredClone(draft.order); },
      },
      activity: { create: async ({ data }) => { if (failAt === "activity") throw new Error("activity failed"); draft.activities.push(data); } },
      auditLog: { create: async ({ data }) => { if (failAt === "audit") throw new Error("audit failed"); draft.audits.push(data); } },
    };
    const result = await callback(tx);
    Object.assign(state, draft);
    return result;
  };
  return { state, calls, transaction };
}

test("исполняемая транзакция сохраняет только снимок адреса и полную историю", async () => {
  const fixture = transactionFixture();
  await fixture.transaction((tx) => persistOrderDeliveryAddress(tx, "order-1", { useClientAddress: false, recipientMatchesClient: false, recipient: "Мария", addressLine1: "Rue 2", city: "Paris", country: "France" }, "owner-1"));
  assert.equal(fixture.calls[0][0], "lock");
  assert.equal(fixture.calls[1][0], "find");
  assert.deepEqual(fixture.calls[1][1].where, { id: "order-1", archivedAt: null });
  const writtenKeys = Object.keys(fixture.calls.find(([name]) => name === "update")[1]).sort();
  assert.deepEqual(writtenKeys, ["country", "deliveryAddressLine1", "deliveryAddressLine2", "deliveryAddressSet", "deliveryAddressText", "deliveryCity", "deliveryPostalCode", "deliveryRecipient", "deliveryRegion"]);
  assert.equal(fixture.state.order.salesStatus, "ORDER_CONFIRMED");
  assert.equal(fixture.state.order.productionStatus, "SCHEDULED");
  assert.equal(fixture.state.order.paymentStatus, "DEPOSIT_PAID");
  assert.equal(fixture.state.order.shippingStatus, "NOT_READY");
  assert.equal(fixture.state.order.measurementId, "measurement-1");
  assert.deepEqual(fixture.state.order.payments, [{ id: "payment-1", amountMinor: 10000 }]);
  assert.equal(fixture.state.activities.length, 1);
  assert.equal(fixture.state.audits.length, 1);
  assert.equal(fixture.state.audits[0].before.deliveryAddressText, "Крещатик, 1, Киев, 01001, Ukraine");
  assert.equal(fixture.state.audits[0].after.deliveryAddressText, "Rue 2, Paris, France");
});

test("архивный или отсутствующий заказ не создаёт записей", async () => {
  const fixture = transactionFixture({ missing: true });
  await assert.rejects(() => fixture.transaction((tx) => persistOrderDeliveryAddress(tx, "order-1", { useClientAddress: true, recipientMatchesClient: true }, "owner-1")), (error) => error instanceof DeliveryAddressOperationError && error.code === DELIVERY_ADDRESS_ERROR.orderNotFound);
  assert.equal(fixture.calls.some(([name]) => name === "update"), false);
  assert.equal(fixture.state.activities.length, 0);
  assert.equal(fixture.state.audits.length, 0);
});

test("непригодный адрес клиента отклоняется до любых записей", async () => {
  const fixture = transactionFixture({ client: { ...makeClient(), address: null, city: "Paris", country: "France" } });
  await assert.rejects(() => fixture.transaction((tx) => persistOrderDeliveryAddress(tx, "order-1", { useClientAddress: true, recipientMatchesClient: true }, "owner-1")), (error) => error instanceof DeliveryAddressOperationError && error.code === DELIVERY_ADDRESS_ERROR.addressRequired);
  assert.equal(fixture.calls.some(([name]) => name === "update"), false);
  assert.equal(fixture.state.activities.length, 0);
  assert.equal(fixture.state.audits.length, 0);
});

for (const failAt of ["activity", "audit"]) test(`ошибка ${failAt} откатывает адрес вместе с историей`, async () => {
  const fixture = transactionFixture({ failAt });
  const before = structuredClone(fixture.state);
  await assert.rejects(() => fixture.transaction((tx) => persistOrderDeliveryAddress(tx, "order-1", { useClientAddress: true, recipientMatchesClient: true }, "owner-1")), new RegExp(`${failAt} failed`));
  assert.deepEqual(fixture.state, before);
});
