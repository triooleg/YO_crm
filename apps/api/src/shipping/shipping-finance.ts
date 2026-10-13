import { PaymentStatus } from "@prisma/client";

type ShippingFinanceInput = {
  priceMinor: number;
  previousDeliveryMinor: number;
  deliveryMinor: number;
  depositRequiredMinor: number;
  paymentStatus: PaymentStatus;
  paidMinor: number;
};

export function shippingCustomerCharge(shipments: readonly { customerChargeMinor: number }[]) {
  return shipments.reduce((sum, shipment) => sum + shipment.customerChargeMinor, 0);
}

export function calculateShippingFinance(input: ShippingFinanceInput) {
  const priceMinor = Math.max(0, input.priceMinor - input.previousDeliveryMinor + input.deliveryMinor);
  const depositRequiredMinor = input.priceMinor > 0
    ? Math.min(priceMinor, Number((BigInt(priceMinor) * BigInt(input.depositRequiredMinor) + BigInt(Math.floor(input.priceMinor / 2))) / BigInt(input.priceMinor)))
    : Math.min(priceMinor, input.depositRequiredMinor);
  const terminal = input.paymentStatus === PaymentStatus.REFUNDED || input.paymentStatus === PaymentStatus.CANCELLED;
  const paymentStatus = terminal
    ? input.paymentStatus
    : input.paidMinor === 0
      ? PaymentStatus.UNPAID
      : input.paidMinor >= priceMinor
        ? PaymentStatus.PAID
        : input.paidMinor >= depositRequiredMinor
          ? PaymentStatus.DEPOSIT_PAID
          : PaymentStatus.PARTIALLY_PAID;
  return { priceMinor, depositRequiredMinor, paymentStatus };
}
