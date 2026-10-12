import assert from "node:assert/strict";
import test from "node:test";

import {
  buildProductionMetrics,
  orderMatchesProductionFilters,
  paymentPresentation,
  productionRange,
  shippingPresentation,
} from "../lib/production-view.ts";

const order = (overrides = {}) => ({
  id: "order-1",
  number: "KC-644",
  notes: "Elvis theme",
  priceMinor: 30000,
  depositRequiredMinor: 15000,
  paidMinor: 0,
  paymentStatus: "UNPAID",
  productionStatus: "SCHEDULED",
  shippingStatus: "NOT_READY",
  currency: "EUR",
  hasTrackingNumber: false,
  client: { displayName: "Paulina Tatara", country: "Poland" },
  items: [{ name: "custom leotard", quantity: 1 }],
  productionSlot: { startsAt: "2026-10-12", endsAt: "2026-10-18", tentative: true, locked: false, capacity: 1 },
  requiredDeliveryAt: "2026-10-21",
  ...overrides,
});

test("масштабы календаря меняют реальный диапазон и ширину дня", () => {
  assert.deepEqual(productionRange("day"), { days: 14, dayWidth: 56, shiftDays: 7 });
  assert.deepEqual(productionRange("week"), { days: 28, dayWidth: 40, shiftDays: 14 });
  assert.deepEqual(productionRange("month"), { days: 42, dayWidth: 32, shiftDays: 28 });
  assert.deepEqual(productionRange("twoMonths"), { days: 70, dayWidth: 24, shiftDays: 56 });
});

test("оплата определяется по фактически применённой сумме, а не сохранённому статусу", () => {
  assert.equal(paymentPresentation(order({ paymentStatus: "PAID" })).code, "unpaid");
  assert.equal(paymentPresentation(order({ paidMinor: 9000 })).code, "partial");
  assert.equal(paymentPresentation(order({ paidMinor: 15000 })).code, "deposit");
  assert.equal(paymentPresentation(order({ paidMinor: 30000 })).code, "paid");
  assert.equal(paymentPresentation(order({ paidMinor: 0, paymentStatus: "REFUNDED" })).code, "refunded");
  assert.equal(paymentPresentation(order({ paidMinor: 0, paymentStatus: "CANCELLED" })).code, "cancelled");
  assert.equal(paymentPresentation(order({ paidMinor: 0, depositRequiredMinor: 0 })).code, "unpaid");
});

test("отправка различает план, накладную и фактическую дату", () => {
  assert.deepEqual(shippingPresentation(order()), { code: "planned", date: "2026-10-21" });
  assert.deepEqual(shippingPresentation(order({ hasTrackingNumber: true })), { code: "tracking", date: "2026-10-21" });
  assert.deepEqual(shippingPresentation(order({ shippedAt: "2026-10-20" })), { code: "shipped", date: "2026-10-20" });
  assert.deepEqual(shippingPresentation(order({ deliveredAt: "2026-10-23" })), { code: "delivered", date: "2026-10-23" });
  assert.deepEqual(shippingPresentation(order({ shippingStatus: "RETURNED", deliveredAt: "2026-10-23" })), { code: "returned", date: "2026-10-23" });
  assert.deepEqual(shippingPresentation(order({ shippingStatus: "LOST", shippedAt: "2026-10-20" })), { code: "lost", date: "2026-10-20" });
});

test("KPI имеют явный знаменатель и считают загрузку слотами", () => {
  const orders = [
    order(),
    order({ id: "order-2", number: "KC-645", paidMinor: 15000, productionSlot: { startsAt: "2026-10-13", endsAt: "2026-10-14", tentative: false, locked: false, capacity: 1 } }),
    order({ id: "order-3", number: "KC-646", paidMinor: 30000, productionSlot: undefined, requiredDeliveryAt: undefined }),
    order({ id: "order-4", number: "KC-647", paidMinor: 0, depositRequiredMinor: 0, productionSlot: undefined, requiredDeliveryAt: undefined }),
    order({ id: "order-5", number: "KC-648", paidMinor: 30000, paymentStatus: "REFUNDED", productionSlot: undefined, requiredDeliveryAt: undefined }),
  ];
  const result = buildProductionMetrics(orders, new Date("2026-10-12T00:00:00"), 7, 2, 3);
  assert.equal(result.total, 5);
  assert.equal(result.scheduled, 2);
  assert.equal(result.depositReceived, 2);
  assert.equal(result.awaitingPayment, 3);
  assert.deepEqual(result.dailyLoad, [1, 2, 2, 1, 1, 1, 1]);
  assert.equal(result.averagePercent, 64);
  assert.equal(result.peakPercent, 100);
  assert.equal(result.nextWindow, "2026-10-15");
});

test("поиск и фильтры работают по клиенту, стране, модели и состояниям", () => {
  const candidate = order({ hasTrackingNumber: true });
  assert.equal(orderMatchesProductionFilters(candidate, { query: "poland", payment: "deposit", production: "all", shipping: "tracking", slot: "tentative", deadline: "all" }), false);
  assert.equal(orderMatchesProductionFilters(candidate, { query: "elvis", payment: "unpaid", production: "SCHEDULED", shipping: "tracking", slot: "tentative", deadline: "all" }), true);
  assert.equal(orderMatchesProductionFilters(order({ requiredDeliveryAt: "2026-10-10" }), { query: "", payment: "all", production: "all", shipping: "all", slot: "all", deadline: "overdue" }, new Date("2026-10-12")), true);
  assert.equal(orderMatchesProductionFilters(order({ requiredDeliveryAt: "2026-10-10", shippedAt: "2026-10-09" }), { query: "", payment: "all", production: "all", shipping: "all", slot: "all", deadline: "overdue" }, new Date("2026-10-12")), false);
});
