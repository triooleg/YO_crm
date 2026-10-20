import assert from "node:assert/strict";
import test from "node:test";

import {
  orderReadyToShip,
  orderDeadlineDays,
  buildProductionMetrics,
  groupProductionOrdersBySchedule,
  orderMatchesProductionFilters,
  paymentPresentation,
  productionOrderIsShipped,
  productionRange,
  productionSlotTimingPresentation,
  shippingPresentation,
  orderProductionStatusPresentation,
  sortProductionOrdersByShippingProximity,
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

test("returned/lost status-only does not fabricate an actual date", () => {
  for (const [shippingStatus, code] of [["RETURNED", "returned"], ["LOST", "lost"]]) {
    assert.deepEqual(shippingPresentation(order({ shippingStatus, hasTrackingNumber: true, salesStatus: "SHIPPED" })), { code, date: null });
  }
});

test("Orders production badge uses the same dispatch evidence without changing stored status", () => {
  const base = { productionStatus: "SCHEDULED", shippingStatus: "NOT_READY", salesStatus: "NEW_LEAD" };
  assert.deepEqual(orderProductionStatusPresentation(base), { domain: "production", status: "SCHEDULED" });
  for (const evidence of [{ salesStatus: "SHIPPED" }, { shippingStatus: "IN_TRANSIT" }, { deliveryTrackingCode: " TRACK " }, { shipment: { trackingNumber: "TRACK" } }, { shipment: { shippedAt: "2026-10-14" } }]) {
    const candidate = { ...base, ...evidence };
    assert.deepEqual(orderProductionStatusPresentation(candidate), { domain: "shipping", status: "SHIPPED" });
    assert.equal(candidate.productionStatus, "SCHEDULED");
  }
  assert.deepEqual(orderProductionStatusPresentation({ ...base, deliveryTrackingCode: "   " }), { domain: "production", status: "SCHEDULED" });
  for (const status of ["DELIVERED", "RETURNED", "LOST"]) {
    assert.deepEqual(orderProductionStatusPresentation({ ...base, shippingStatus: status, salesStatus: "SHIPPED", deliveryTrackingCode: "TRACK" }), { domain: "shipping", status });
  }
  assert.deepEqual(orderProductionStatusPresentation({ ...base, shipment: { deliveredAt: "2026-10-14" } }), { domain: "shipping", status: "DELIVERED" });
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
  assert.deepEqual(shippingPresentation(order({ hasTrackingNumber: true })), { code: "shipped", date: null });
  assert.deepEqual(shippingPresentation(order({ shippedAt: "2026-10-20" })), { code: "shipped", date: "2026-10-20" });
  assert.deepEqual(shippingPresentation(order({ deliveredAt: "2026-10-23" })), { code: "delivered", date: "2026-10-23" });
  assert.deepEqual(shippingPresentation(order({ shippingStatus: "RETURNED", deliveredAt: "2026-10-23" })), { code: "returned", date: "2026-10-23" });
  assert.deepEqual(shippingPresentation(order({ shippingStatus: "LOST", shippedAt: "2026-10-20" })), { code: "lost", date: "2026-10-20" });
});

test("транспортный статус без фактической даты не подменяется плановой отправкой", () => {
  for(const shippingStatus of ["SHIPPED","IN_TRANSIT"])
    assert.deepEqual(shippingPresentation(order({shippingStatus,shippedAt:null})),{code:"shipped",date:null});
  assert.deepEqual(shippingPresentation(order({shippingStatus:"DELIVERED",deliveredAt:null})),{code:"delivered",date:null});
});

test("отправленный производственный слот определяется фактом или статусом отправки", () => {
  assert.equal(productionOrderIsShipped(order({salesStatus:"SHIPPED",shippingStatus:"NOT_READY",hasTrackingNumber:false})),true);
  assert.deepEqual(shippingPresentation(order({salesStatus:"SHIPPED",shippingStatus:"NOT_READY",hasTrackingNumber:true})),{code:"shipped",date:null});
  assert.deepEqual(shippingPresentation(order({salesStatus:"DELIVERED",shippingStatus:"NOT_READY",hasTrackingNumber:true})),{code:"delivered",date:null});
  assert.equal(productionOrderIsShipped(order({salesStatus:"READY_TO_SHIP",shippingStatus:"LABEL_CREATED",hasTrackingNumber:false})),false);
  assert.equal(productionOrderIsShipped(order({ shippedAt: "2026-10-20" })), true);
  assert.equal(productionOrderIsShipped(order({ shippingStatus: "SHIPPED", shippedAt: null })), true);
  assert.equal(productionOrderIsShipped(order({ shippingStatus: "IN_TRANSIT", shippedAt: null })), true);
  assert.equal(productionOrderIsShipped(order({ shippingStatus: "DELIVERED", deliveredAt: "2026-10-22" })), true);
  assert.equal(productionOrderIsShipped(order({ hasTrackingNumber: true, shippingStatus: "LABEL_CREATED" })), true);
  assert.equal(productionOrderIsShipped(order({hasTrackingNumber:false,shippingStatus:"LABEL_CREATED"})),false);
  assert.equal(shippingPresentation(order({hasTrackingNumber:true,salesStatus:"SHIPPED",shippingStatus:"RETURNED"})).code,"returned");
  assert.equal(shippingPresentation(order({hasTrackingNumber:true,salesStatus:"DELIVERED",shippingStatus:"LOST",deliveredAt:"2026-10-23"})).code,"lost");
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
  assert.equal(result.awaitingPayment, 2);
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

test("сортировка по отправке ставит ближайшие к сегодня даты первыми и не меняет исходный список", () => {
  const orders = [
    order({ id: "future-10", number: "KC-650", requiredDeliveryAt: "2026-10-22" }),
    order({ id: "missing", number: "KC-651", requiredDeliveryAt: undefined }),
    order({ id: "past-1", number: "KC-652", requiredDeliveryAt: "2026-10-11" }),
    order({ id: "today", number: "KC-653", requiredDeliveryAt: "2026-10-12" }),
    order({ id: "future-2", number: "KC-654", requiredDeliveryAt: "2026-10-14" }),
  ];

  assert.deepEqual(
    sortProductionOrdersByShippingProximity(orders, new Date("2026-10-12T12:00:00")).map(({ id }) => id),
    ["today", "past-1", "future-2", "future-10", "missing"],
  );
  assert.deepEqual(orders.map(({ id }) => id), ["future-10", "missing", "past-1", "today", "future-2"]);
});

test("сортировка отправки использует shippedAt, а deliveredAt не подменяет дату отправки", () => {
  const orders = [
    order({ id: "planned", requiredDeliveryAt: "2026-10-14" }),
    order({ id: "delivered", requiredDeliveryAt: "2026-10-30", shippedAt: "2026-10-11", deliveredAt: "2026-10-12" }),
  ];
  assert.deepEqual(sortProductionOrdersByShippingProximity(orders, new Date("2026-10-12")).map(({ id }) => id), ["delivered", "planned"]);
});

test("hover слота различает остаток, сегодняшний срок, просрочку и завершённое производство", () => {
  assert.deepEqual(productionSlotTimingPresentation(order({ productionSlot: { startsAt: "2026-10-10", endsAt: "2026-10-15" } }), new Date("2026-10-12")), { duration: 6, code: "remaining", days: 3 });
  assert.deepEqual(productionSlotTimingPresentation(order({ productionSlot: { startsAt: "2026-10-10", endsAt: "2026-10-12" } }), new Date("2026-10-12")), { duration: 3, code: "remaining", days: 0 });
  assert.deepEqual(productionSlotTimingPresentation(order({ productionSlot: { startsAt: "2026-10-08", endsAt: "2026-10-10" } }), new Date("2026-10-12")), { duration: 3, code: "overdue", days: 2 });
  assert.deepEqual(productionSlotTimingPresentation(order({ productionStatus: "READY", productionSlot: { startsAt: "2026-10-01", endsAt: "2026-10-05" } }), new Date("2026-10-12")), { duration: 5, code: "completed", days: 0 });
  assert.deepEqual(productionSlotTimingPresentation(order({ shippingStatus: "SHIPPED", productionStatus: "SCHEDULED", productionSlot: { startsAt: "2026-10-01", endsAt: "2026-10-05" } }), new Date("2026-10-12")), { duration: 5, code: "completed", days: 0 });
});

test("режим графика сохраняет запланированные заказы выше незапланированных", () => {
  const orders = [order({ id: "unscheduled-1", productionSlot: undefined }), order({ id: "scheduled-1" }), order({ id: "unscheduled-2", productionSlot: undefined }), order({ id: "scheduled-2" })];
  assert.deepEqual(groupProductionOrdersBySchedule(orders).map(({ id }) => id), ["scheduled-1", "scheduled-2", "unscheduled-1", "unscheduled-2"]);
  assert.deepEqual(orders.map(({ id }) => id), ["unscheduled-1", "scheduled-1", "unscheduled-2", "scheduled-2"]);
});


test('lost parcel is terminal and does not remain in the overdue-production cohort',()=>{
 const candidate=order({shippingStatus:'LOST',requiredDeliveryAt:'2026-10-01'});
 assert.equal(orderMatchesProductionFilters(candidate,{query:'',payment:'all',production:'all',shipping:'all',slot:'all',deadline:'overdue'},new Date('2026-10-15')),false);
});

test('unknown settlement is not counted as unpaid or deposit covered',()=>{
 const unknown=order({paymentSettlementKnown:false,paidMinor:0});
 assert.equal(paymentPresentation(unknown).code,'unknown');
 assert.equal(paymentPresentation({...unknown,paymentStatus:'REFUNDED'}).code,'refunded');
 assert.equal(paymentPresentation({...unknown,paymentStatus:'CANCELLED'}).code,'cancelled');
 const metrics=buildProductionMetrics([unknown],new Date('2026-10-15'),1,4,1);
 assert.equal(metrics.awaitingPayment,0);
 assert.equal(metrics.depositReceived,0);
 assert.equal(metrics.paymentUnknown,1);
});

test('ready to ship excludes terminal orders and dispatched parcels',()=>{
 for(const overrides of [{salesStatus:'CANCELLED'},{salesStatus:'COMPLETED'},{shippingStatus:'LOST'},{shippingStatus:'RETURNED'},{deliveryTrackingCode:'TRACK'},{shippingStatus:'SHIPPED'}]) assert.equal(orderReadyToShip({...order({productionStatus:'READY',shippingStatus:'READY'}),...overrides}),false);
 assert.equal(orderReadyToShip(order({productionStatus:'READY',shippingStatus:'READY'})),true);
 assert.equal(orderReadyToShip(order({salesStatus:'READY_TO_SHIP',productionStatus:'SCHEDULED',shippingStatus:'NOT_READY'})),true);
});
test('order deadline labels count calendar days rather than remaining 24 hour blocks',()=>{
 const today=new Date(2026,9,15,10);
 assert.equal(orderDeadlineDays({requiredDeliveryAt:new Date(2026,9,14,14).toISOString()},today),-1);
 assert.equal(orderDeadlineDays({requiredDeliveryAt:new Date(2026,9,15,15).toISOString()},today),0);
});
