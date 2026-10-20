import assert from "node:assert/strict";
import test from "node:test";
import { PaymentStatus } from "@prisma/client";
import { calculateShippingFinance, shippingCustomerCharge } from "../src/shipping/shipping-finance.ts";

test("две посылки учитывают клиентскую доставку ровно один раз", () => {
  const deliveryMinor = shippingCustomerCharge([{ customerChargeMinor: 1000 }, { customerChargeMinor: 500 }]);
  assert.equal(deliveryMinor, 1500);
  assert.deepEqual(calculateShippingFinance({
    priceMinor: 11_000,
    previousDeliveryMinor: 1_000,
    deliveryMinor,
    depositRequiredMinor: 5_500,
    paymentStatus: PaymentStatus.PARTIALLY_PAID,
    paidMinor: 5_750,
  }), {
    priceMinor: 11_500,
    depositRequiredMinor: 5_750,
    paymentStatus: PaymentStatus.DEPOSIT_PAID,
  });
});

test("изменение расходов ателье не входит в долг клиента", () => {
  const customerDeliveryMinor = shippingCustomerCharge([
    { customerChargeMinor: 1_000, atelierCostMinor: 900 },
    { customerChargeMinor: 500, atelierCostMinor: 2_000 },
  ]);
  assert.equal(customerDeliveryMinor, 1_500);
});

test("закрытый платёжный статус не переписывается пересчётом доставки", () => {
  assert.equal(calculateShippingFinance({
    priceMinor: 10_000,
    previousDeliveryMinor: 0,
    deliveryMinor: 1_000,
    depositRequiredMinor: 5_000,
    paymentStatus: PaymentStatus.REFUNDED,
    paidMinor: 0,
  }).paymentStatus, PaymentStatus.REFUNDED);
});
