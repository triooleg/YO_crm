import assert from "node:assert/strict";
import test from "node:test";
import {
  keycrmDate,
  keycrmMoneyToMinor,
  keycrmRequiredMoneyToMinor,
  normalizeKeycrmOrder,
} from "../src/keycrm/keycrm-normalizer.ts";
const options = { connectionKey: "connection-a", defaultCurrency: "EUR", sourceNames: {}, sourceCurrencies: { "1": "EUR", "12": "EUR" } };

test("денежные значения KeyCRM переводятся в minor units без float-арифметики", () => {
  assert.equal(keycrmMoneyToMinor("330.00"), 33000);
  assert.equal(keycrmMoneyToMinor(165.5), 16550);
  assert.equal(keycrmMoneyToMinor("-0.01"), -1);
  assert.equal(keycrmMoneyToMinor(null), 0);
  assert.throws(() => keycrmMoneyToMinor("1.234"), /более двух знаков/);
  assert.throws(() => keycrmRequiredMoneyToMinor(null, "Стоимость"), /не передана/);
  assert.throws(() => keycrmRequiredMoneyToMinor("-1", "Стоимость"), /неотрицательной/);
  assert.throws(() => keycrmRequiredMoneyToMinor("0", "Оплата", false), /положительной/);
});

test("даты KeyCRM без зоны трактуются как UTC", () => {
  assert.equal(keycrmDate("2026-09-16 11:24:00")?.toISOString(), "2026-09-16T11:24:00.000Z");
  assert.equal(keycrmDate(null), null);
});

test("заказ нормализуется вместе с клиентом, товарами, оплатами и доставкой", () => {
  const order = normalizeKeycrmOrder({
    id: 675,
    source_id: 12,
    source_uuid: "web-675",
    grand_total: "330.00",
    total_discount: 10,
    taxes: "2.50",
    shipping_price: 20,
    wrap_price: 3,
    ordered_at: "2026-09-16 11:24:00",
    updated_at: "2026-09-16 12:00:00",
    payment_status: "part_paid",
    buyer_comment: "Груди 57 Талия 51",
    manager_comment: "Проверить размер",
    buyer: { id: 77, full_name: "Veronika", email: "V@Example.COM", phone: "00 380 (50) 123-45-67" },
    status: { id: 23, name: "Ожидает оплату", alias: "waiting-payment", group_id: 1 },
    products: [{ id: 91, name: "custom leotard", sku: "YO-1", price: 330, quantity: 1, picture: "https://example.com/model.jpg", comment: "Груди 57" }],
    payments: [{ id: 5, amount: 165, actual_currency: "EUR", payment_method_id: 8, status: "paid", payment_date: "2026-09-16 11:25:00" }],
    shipping: { shipping_address_country: "United Arab Emirates", shipping_address_city: "Dubai", shipping_receive_point: "Office 2", recipient_full_name: "Veronika", recipient_phone: "+971500000000", tracking_code: "TRACK-1", shipping_date_actual: "2026-09-30T00:00:00.000000Z" },
    custom_fields: [
      { id: 1, uuid: "OR_1", name: "Номер макету", type: "number", value: 486 },
      { id: 2, uuid: "OR_1001", name: "Початок виробництва", type: "date", value: "2026-09-20" },
      { id: 5, uuid: "OR_1004", name: "Очікувана дата доставки", type: "date", value: "2026-09-30" },
    ],
  }, { ...options, sourceNames: { "12": "Сайт Yoleotard" } });

  assert.equal(order.externalId, "675");
  assert.equal(order.sourceAccount, "connection-a");
  assert.equal(order.number, "KC-675");
  assert.equal(order.priceMinor, 33000);
  assert.equal(order.depositRequiredMinor, 16500);
  assert.equal(order.paymentStatus, "PARTIALLY_PAID");
  assert.equal(order.client.displayName, "Veronika");
  assert.equal(order.client.email, "v@example.com");
  assert.equal(order.client.phone, "+380501234567");
  assert.equal(order.client.source, "WEBSITE");
  assert.equal(order.items[0].externalId, "675:91");
  assert.equal(order.items[0].externalImageUrl, "https://example.com/model.jpg");
  assert.equal(order.payments[0].externalId, "5");
  assert.equal(order.delivery.country, "United Arab Emirates");
  assert.equal(order.delivery.recipientPhone, "+971500000000");
  assert.equal(order.shippingStatus, "NOT_READY");
  assert.equal(order.customFields[0].name, "Номер макету");
  assert.equal(order.production.startsAt?.toISOString(), "2026-09-20T00:00:00.000Z");
  assert.equal(order.production.requiredDeliveryAt?.toISOString(), "2026-09-30T00:00:00.000Z");
});

test("производственные даты используют UUID или точное имя с явным fallback и строгим date-контрактом", () => {
  const base = { id: 21, source_id: 1, created_at: "2026-01-02 03:04:05", grand_total: 10, buyer: { id: 1, full_name: "Client" } };
  const byNameOnly = normalizeKeycrmOrder({ ...base, custom_fields: [{ id: 99, uuid: "OTHER", name: "Початок виробництва", type: "date", value: "2026-02-01" }] }, options);
  assert.equal(byNameOnly.production.startsAt?.toISOString(), "2026-02-01T00:00:00.000Z");
  assert.deepEqual(byNameOnly.production.exactNameFallbacks, ["Початок виробництва"]);
  const configuredMissing = normalizeKeycrmOrder({ ...base, custom_fields: [{ id: 99, uuid: "OTHER", name: "Початок виробництва", type: "date", value: "2026-02-01" }] }, { ...options, productionStartFieldUuid: "EXPECTED" });
  assert.equal(configuredMissing.production.startsAt, null);
  assert.deepEqual(configuredMissing.production.exactNameFallbacks, []);
  assert.throws(() => normalizeKeycrmOrder({ ...base, custom_fields: [{ id: 2, uuid: "OR_1001", name: "Початок виробництва", type: "date", value: "01.02.2026" }] }, options), /Початок виробництва/);
  assert.throws(() => normalizeKeycrmOrder({ ...base, custom_fields: [{ id: 2, uuid: "OR_1001", name: "Початок виробництва", type: "text", value: "2026-02-01" }] }, options), /тип date/);
});

test("штатная shipping_date KeyCRM используется без UUID, когда ожидаемая дата из custom field не заполнена", () => {
  const base = {
    id: 22,
    source_id: 1,
    created_at: "2026-01-02 03:04:05",
    grand_total: 10,
    buyer: { id: 1, full_name: "Client" },
    shipping: { shipping_date: "2027-01-18" },
  };
  const fromShipping = normalizeKeycrmOrder(base, options);
  assert.equal(fromShipping.production.requiredDeliveryAt?.toISOString(), "2027-01-18T00:00:00.000Z");
  assert.equal(fromShipping.delivery.shippedAt, null);

  const customWins = normalizeKeycrmOrder({
    ...base,
    custom_fields: [{ id: 5, uuid: "DELIVERY", name: "Очікувана дата доставки", type: "date", value: "2027-01-20" }],
  }, { ...options, expectedDeliveryFieldUuid: "DELIVERY" });
  assert.equal(customWins.production.requiredDeliveryAt?.toISOString(), "2027-01-20T00:00:00.000Z");

  const legacyResponse = normalizeKeycrmOrder({
    ...base,
    shipping: { shipping_date_actual: "2027-01-19T00:00:00.000000Z" },
  }, options);
  assert.equal(legacyResponse.production.requiredDeliveryAt?.toISOString(), "2027-01-19T00:00:00.000Z");
  assert.equal(legacyResponse.delivery.shippedAt?.toISOString(), "2027-01-19T00:00:00.000Z");
});

test("недокументированный ID предложения не используется как ID строки заказа", () => {
  const base = {
    source_id: 12,
    created_at: "2026-01-02 03:04:05",
    grand_total: "10.00",
    buyer: { id: 1, full_name: "Client" },
    products: [{ offer: { id: 91 }, name: "Model", price: "10.00", quantity: 1 }],
  };
  const first = normalizeKeycrmOrder({ ...base, id: 675 }, options);
  const second = normalizeKeycrmOrder({ ...base, id: 676 }, options);
  assert.equal(first.items[0].externalId, null);
  assert.equal(second.items[0].externalId, null);
  assert.throws(
    () => normalizeKeycrmOrder({ ...base, id: 677, products: [{ name: "Model", price: 10, quantity: 1.5 }] }, options),
    /Количество товара/,
  );
  assert.throws(
    () => normalizeKeycrmOrder({ ...base, id: 678, products: [{ id: 1, name: "Model", price: -1, quantity: 1 }] }, options),
    /Цена товара 1 не может быть отрицательной/,
  );
});

test("внешнее изображение принимается только по HTTPS", () => {
  const order = normalizeKeycrmOrder({
    id: 20,
    source_id: 1,
    created_at: "2026-01-02 03:04:05",
    grand_total: 10,
    buyer: { id: 1, full_name: "Client" },
    products: [{ id: 2, name: "Model", price: 10, quantity: 1, picture: "http://example.com/model.jpg" }],
  }, options);
  assert.equal(order.items[0].externalImageUrl, null);
});

test("изображение товара KeyCRM принимается из актуального объекта picture", () => {
  const base = {
    id: 23,
    source_id: 1,
    created_at: "2026-01-02 03:04:05",
    grand_total: 20,
    buyer: { id: 1, full_name: "Client" },
  };
  const full = normalizeKeycrmOrder({
    ...base,
    products: [{ id: 3, name: "Model", price: 10, quantity: 1, picture: { url: "https://cdn.example.com/full.jpg", thumbnail: "https://cdn.example.com/thumb.jpg" } }],
  }, options);
  const thumbnail = normalizeKeycrmOrder({
    ...base,
    id: 24,
    products: [{ id: 4, name: "Model", price: 10, quantity: 1, picture: { thumbnail: "https://cdn.example.com/thumb-only.jpg" } }],
  }, options);

  assert.equal(full.items[0].externalImageUrl, "https://cdn.example.com/full.jpg");
  assert.equal(thumbnail.items[0].externalImageUrl, "https://cdn.example.com/thumb-only.jpg");
});

test("статусы неоплаченных и отмененных платежей сохраняются для сверки истории", () => {
  const order = normalizeKeycrmOrder({
    id: 10,
    source_id: 1,
    created_at: "2026-01-02 03:04:05",
    grand_total: 100,
    payment_status: "not_paid",
    buyer: { id: 1, full_name: "Client" },
    payments: [
      { id: 1, amount: 50, status: "not_paid" },
      { id: 2, amount: 50, status: "canceled" },
    ],
  }, options);
  assert.deepEqual(order.payments.map((payment) => payment.externalStatus), ["not_paid", "canceled"]);
  assert.equal(order.payments[0].isPaid, false);
  assert.equal(order.paymentStatus, "UNPAID");
});

test("оплаченная транзакция без даты отклоняется одинаково в preview и apply", () => {
  assert.throws(() => normalizeKeycrmOrder({
    id: 11,
    source_id: 1,
    created_at: "2026-01-02 03:04:05",
    grand_total: 100,
    buyer: { id: 1, full_name: "Client" },
    payments: [{ id: 3, amount: 50, status: "paid" }],
  }, options), /дату оплаты/);
});

test("единственная валюта проведённых оплат уточняет валюту исторического заказа", () => {
  const order = normalizeKeycrmOrder({
    id: 12,
    source_id: 1,
    created_at: "2026-01-02 03:04:05",
    grand_total: 100,
    buyer: { id: 1, full_name: "Client" },
    payments: [{ id: 4, amount: 50, status: "paid", payment_date: "2026-01-02 04:00:00", actual_currency: "USD" }],
  }, options);
  assert.equal(order.currency, "USD");
  assert.equal(order.payments[0].currency, "USD");
});

test("несколько валют проведённых оплат отклоняются без догадок", () => {
  assert.throws(() => normalizeKeycrmOrder({
    id: 13,
    source_id: 1,
    created_at: "2026-01-02 03:04:05",
    grand_total: 100,
    buyer: { id: 1, full_name: "Client" },
    payments: [
      { id: 5, amount: 50, status: "paid", payment_date: "2026-01-02 04:00:00", actual_currency: "USD" },
      { id: 6, amount: 50, status: "paid", payment_date: "2026-01-02 05:00:00", actual_currency: "EUR" },
    ],
  }, options), /несколько валют проведённых оплат/);
});

test("отменённая оплата в другой валюте остаётся в raw payload и не блокирует заказ", () => {
  const raw = {
    id: 14,
    source_id: 1,
    created_at: "2026-01-02 03:04:05",
    grand_total: 100,
    buyer: { id: 1, full_name: "Client" },
    payments: [
      { id: 7, amount: 50, status: "paid", payment_date: "2026-01-02 04:00:00", actual_currency: "EUR" },
      { id: 8, amount: 50, status: "canceled", actual_currency: "UAH" },
    ],
  };
  const order = normalizeKeycrmOrder(raw, options);
  assert.equal(order.currency, "EUR");
  assert.deepEqual(order.payments.map((payment) => payment.externalId), ["7", "8"]);
  assert.equal(order.payments[1].materializeIfMissing, false);
  assert.equal(order.externalData, raw);
});

test("некорректная валюта отменённой оплаты не маскируется как чужая валюта", () => {
  assert.throws(() => normalizeKeycrmOrder({
    id: 15,
    source_id: 1,
    created_at: "2026-01-02 03:04:05",
    grand_total: 100,
    buyer: { id: 1, full_name: "Client" },
    payments: [{ id: 9, amount: 50, status: "canceled", actual_currency: "EURO" }],
  }, options), /ISO 4217/);
});

test("одинаковые ID разных подключений остаются в разных областях", () => {
  const raw = { id: 10, source_id: 1, source_uuid: "site-10", created_at: "2026-01-02 03:04:05", grand_total: 100, buyer: { id: 1, full_name: "Client" } };
  const first = normalizeKeycrmOrder(raw, { ...options, connectionKey: "account-a" });
  const second = normalizeKeycrmOrder(raw, { ...options, connectionKey: "account-b" });
  assert.equal(first.externalId, second.externalId);
  assert.notEqual(first.sourceAccount, second.sourceAccount);
});

test("нормализация не выдумывает дату или валюту исторического заказа", () => {
  const base = { id: 10, source_id: 1, grand_total: 100, buyer: { id: 1, full_name: "Client" } };
  assert.throws(() => normalizeKeycrmOrder(base, options), /дату создания заказа/);
  assert.throws(() => normalizeKeycrmOrder({ ...base, created_at: "2026-01-02 03:04:05", source_id: 999 }, options), /не указана валюта/);
  assert.throws(() => normalizeKeycrmOrder({ ...base, created_at: "2026-01-02 03:04:05", payments: [{ id: 1, amount: 10, status: "paid", payment_date: "2026-01-02 04:00:00", actual_currency: "EURO" }] }, options), /ISO 4217/);
});
