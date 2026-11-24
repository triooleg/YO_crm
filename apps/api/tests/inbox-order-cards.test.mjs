import test from "node:test";
import assert from "node:assert/strict";
import { loadTargetModule } from "./website-test-loader.mjs";
import { orderSettlement } from "../../web/lib/order-settlement.mjs";
import { orderMeasurementState } from "../../web/lib/order-measurement-state.ts";

const { CommunicationsService } = loadTargetModule("communications/communications.service.ts");
const base = {
  clientId: "buyer", currency: "EUR", priceMinor: 35000, payments: [],
  type: "CUSTOM_ORDER", salesStatus: "NEW_LEAD", shippingStatus: "NOT_READY",
  items: [], orderShipments: [], shipment: null, _count: { items: 0, compositionOperations: 0 },
};
const trackingNumber = "PC0000020000077161NPG";
const trackingUrl = `https://nova.global/en-ua/track/?Tracking_ID=${trackingNumber}`;

test("Inbox order cards read settlement and assignment evidence for active and historical orders", async () => {
  const snapshot = { athlete: { id: "athlete", clientId: "buyer", archivedAt: null }, measurement: { athleteId: "athlete" } };
  const receipt = { currency: "USD", amountMinor: 20500, appliedCurrency: "EUR", appliedAmountMinor: 20000 };
  const settled = { currency: "EUR", amountMinor: 35000 };
  const rows = [
    { ...base, id: "active", payments: [receipt], items: [{ quantity: 1, _count: { instances: 1 }, instances: [{ id: "piece", ...snapshot }] }] },
    { ...base, id: "sent", salesStatus: "COMPLETED", payments: [settled], shipment: { carrier: "NOVA_GLOBAL", trackingNumber } },
    { ...base, id: "other", shipment: { carrier: "NOVA_GLOBAL", trackingNumber }, deliveryTrackingCode: trackingNumber, orderShipments: [
      { carrier: "NOVA_GLOBAL", status: "SHIPPED", trackingNumber, trackingUrl, instances: [] },
      { carrier: "NOVA_GLOBAL", status: "SHIPPED", trackingNumber: "UNKNOWN", trackingUrl: "https://example.test/", instances: [] },
      { carrier: "NOVA_GLOBAL", status: "NOT_READY", trackingNumber: null, instances: [] },
    ] },
    { ...base, id: "cancelled", salesStatus: "CANCELLED" },
    { ...base, id: "single", orderShipments: [{ carrier: "NOVA_GLOBAL", status: "IN_TRANSIT", trackingNumber, instances: [] }] },
    ...["LABEL_CREATED", "READY", "NOT_READY", "SHIPPED"].map(status => ({
      ...base, id: status, shipment: { carrier: "NOVA_GLOBAL", trackingNumber },
      items: [{ quantity: 1, _count: { instances: 1 }, instances: [{ id: "piece" }] }],
      orderShipments: [{ carrier: "NOVA_GLOBAL", status, trackingNumber, instances: [{ id: "piece" }] }],
    })),
    { ...base, id: "single-unallocated", items: [{
      quantity: 2, _count: { instances: 2 }, instances: [{ id: "first" }, { id: "second" }],
    }], orderShipments: [{ carrier: "NOVA_GLOBAL", status: "SHIPPED", trackingNumber, instances: [] }] },
  ];
  const db = { order: { findMany: async ({ where, select }) => {
    assert.deepEqual(where, { clientId: "buyer", archivedAt: null, client: { archivedAt: null } });
    assert.equal(select.payments.where.voidedAt, null);
    assert.equal(select.payments.select.appliedAmountMinor, true);
    assert.equal(select.items.where.archivedAt, null);
    assert.equal(select.items.select.instances.where.archivedAt, null);
    assert.equal(select.items.select.instances.select.measurement.select.athleteId, true);
    assert.equal(select.orderShipments.where.archivedAt, null);
    return rows;
  } } };
  const [active, sent, other, cancelled, single, labelOnly, readyOnly, notReadyOnly, covered, unallocated] = JSON.parse(JSON.stringify(await new CommunicationsService(db, {}).clientOrderCards("buyer")));
  assert.deepEqual(active.payments, [receipt]);
  assert.deepEqual(active.items[0].instances[0].measurement, snapshot.measurement);
  assert.equal(orderMeasurementState(active).complete, true);
  assert.equal(orderMeasurementState({ ...active, items: [{ ...active.items[0], quantity: 2 }] }).complete, false);
  assert.deepEqual(orderSettlement(active), { paidMinor: 20000, balanceMinor: 15000 });
  assert.equal(active.isActive, true);
  assert.equal(sent.isActive, false);
  assert.deepEqual(orderSettlement(sent), { paidMinor: 35000, balanceMinor: 0 });
  assert.equal(sent.dispatchStatus, "SHIPPED");
  assert.deepEqual(sent.deliveryCarriers, ["NOVA_GLOBAL"]);
  assert.deepEqual(active.deliveryCarriers, []);
  assert.deepEqual(sent.tracking, [{ number: trackingNumber, url: `https://nova.global/track/?Tracking_ID=${trackingNumber}` }]);
  assert.equal(other.isActive, true);
  assert.equal(other.dispatchStatus, "PARTIALLY_SHIPPED");
  assert.deepEqual(other.tracking, [{ number: trackingNumber, url: trackingUrl }, { number: "UNKNOWN" }]);
  assert.equal(cancelled.isActive, false);
  assert.equal(cancelled.dispatchStatus, null);
  for (const unsent of [labelOnly, readyOnly, notReadyOnly]) {
    assert.equal(unsent.dispatchStatus, null);
    assert.equal(unsent.tracking[0].number, trackingNumber);
  }
  assert.equal(covered.dispatchStatus, "SHIPPED");
  assert.equal(single.dispatchStatus, "PARTIALLY_SHIPPED");
  assert.equal(unallocated.dispatchStatus, "PARTIALLY_SHIPPED");
  assert.deepEqual(orderSettlement(cancelled), { paidMinor: 0, balanceMinor: 35000 });
});

test("legacy orders keep owned snapshot fallback, while archived physical assignments do not revive it", async () => {
  const athlete = { id: "athlete", clientId: "buyer", archivedAt: null };
  const measurement = { athleteId: athlete.id };
  const item = { quantity: 1, instances: [], _count: { instances: 0 } };
  const db = { order: { findMany: async () => [
    { ...base, id: "legacy-order", athlete, measurement, items: [item] },
    { ...base, id: "legacy-item", athlete, items: [{ ...item, measurement }] },
    { ...base, id: "physical", athlete, measurement, items: [{ ...item, _count: { instances: 1 } }] },
  ] } };
  const [legacyOrder, legacyItem, physical] = await new CommunicationsService(db, {}).clientOrderCards("buyer");
  assert.equal(orderMeasurementState(legacyOrder).complete, true);
  assert.equal(orderMeasurementState(legacyItem).complete, true);
  assert.equal(orderMeasurementState(physical).complete, false);
});

test("Inbox order cards present the website design and retain a safe missing-image state", async () => {
  const websiteImage = "https://yoleotard.com/wp-content/uploads/ice-symphony.jpg";
  const orderImage = "https://www.yoleotard.com/wp-content/uploads/checkout.jpg";
  const website = { ...base, sourceSystem: "YOLEOTARD_WEBSITE", externalImageUrl: orderImage };
  const item = { name: "Ice Symphony", quantity: 1, _count: { instances: 0 }, instances: [] };
  const rows = [
    { ...website, items: [{ ...item, externalImageUrl: websiteImage }] },
    { ...website, items: [item] },
    { ...website, items: [{ ...item, modelImagePath: "a1b2c3.jpg", externalImageUrl: websiteImage }] },
    { ...website, _count: { items: 1, compositionOperations: 1 } },
    { ...base, externalImageUrl: websiteImage },
    { ...website, externalImageUrl: "https://yoleotard.com/photo.png?token=private" },
  ];
  const db = { order: { findMany: async ({ select }) => {
    assert.equal(select.externalImageUrl, true);
    assert.equal(select.sourceSystem, true);
    assert.equal(select.items.select.externalImageUrl, true);
    assert.equal(select.items.select.modelImagePath, true);
    return rows;
  } } };
  const cards = await new CommunicationsService(db, {}).clientOrderCards("buyer");
  assert.deepEqual(cards.map(card => card.designImageUrl), [
    websiteImage, orderImage, "/api/orders/images/a1b2c3.jpg", null, null, null,
  ]);
  assert.equal(cards[0].items[0].name, "Ice Symphony");
  assert.equal("externalImageUrl" in cards[0], false);
});
