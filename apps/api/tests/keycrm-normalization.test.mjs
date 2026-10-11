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
    custom_fields: [{ id: 1, uuid: "OR_1", name: "Номер макету", type: "number", value: 486 }],
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

test("валюта оплаты должна совпадать с валютой заказа", () => {
  assert.throws(() => normalizeKeycrmOrder({
    id: 12,
    source_id: 1,
    created_at: "2026-01-02 03:04:05",
    grand_total: 100,
    buyer: { id: 1, full_name: "Client" },
    payments: [{ id: 4, amount: 50, status: "paid", payment_date: "2026-01-02 04:00:00", actual_currency: "USD" }],
  }, options), /не совпадает с валютой заказа/);
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
