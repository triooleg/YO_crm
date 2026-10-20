import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { orderDeliveryErrorMessage } from "../lib/order-delivery-errors.ts";
import { hasUsableDeliveryAddress } from "../lib/order-delivery-address.ts";

const dictionary = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const messages = { addressRequired: "Укажите адрес доставки", recipientRequired: "Укажите получателя доставки", orderNotFound: "Заказ не найден" };

test("стабильные HTTP-коды адреса переводятся только централизованным словарём", () => {
  assert.equal(orderDeliveryErrorMessage("ORDER_DELIVERY_ADDRESS_REQUIRED", messages), messages.addressRequired);
  assert.equal(orderDeliveryErrorMessage("ORDER_DELIVERY_RECIPIENT_REQUIRED", messages), messages.recipientRequired);
  assert.equal(orderDeliveryErrorMessage("ORDER_DELIVERY_ORDER_NOT_FOUND", messages), messages.orderNotFound);
  assert.equal(orderDeliveryErrorMessage("UNKNOWN", messages), undefined);
  assert.match(dictionary, /deliveryAddressRequired:\s*"Укажите адрес доставки"/);
  assert.match(dictionary, /deliveryRecipientRequired:\s*"Укажите получателя доставки"/);
  assert.match(dictionary, /deliveryOrderNotFound:\s*"Заказ не найден"/);
});

test("готовность доставки требует улицу или явно сохранённый полный адрес", () => {
  assert.equal(hasUsableDeliveryAddress({ client: { country: "France" } }), false);
  assert.equal(hasUsableDeliveryAddress({ client: { address: "Rue 2" } }), true);
  assert.equal(hasUsableDeliveryAddress({ deliveryAddressSet: true, client: {}, deliveryAddressLine1: "", deliveryAddressText: "", country: "France" }), false);
  assert.equal(hasUsableDeliveryAddress({ deliveryAddressSet: true, client: {}, deliveryAddressText: "BP 42, Paris" }), true);
});
