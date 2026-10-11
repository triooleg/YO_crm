import { PaymentStatus, ProductionStatus, type Prisma } from "@prisma/client";

export const ORDER_DETAILS_ERROR = {
  orderNotFound: "ORDER_DETAILS_ORDER_NOT_FOUND",
  imageChanged: "ORDER_DETAILS_IMAGE_CHANGED",
  changed: "ORDER_DETAILS_CHANGED",
  descriptionRequired: "ORDER_DETAILS_DESCRIPTION_REQUIRED",
  depositWouldUnconfirmProduction: "ORDER_DETAILS_DEPOSIT_WOULD_UNCONFIRM_PRODUCTION",
} as const;

type OrderDetailsErrorCode = (typeof ORDER_DETAILS_ERROR)[keyof typeof ORDER_DETAILS_ERROR];

export type OrderDetailsInput = {
  description: string;
  priceMinor: number;
  expectedDescription: string | null;
  expectedPriceMinor: number;
  modelImagePath?: string;
  expectedModelImagePath: string | null;
};

export class OrderDetailsOperationError extends Error {
  readonly code: OrderDetailsErrorCode;
  constructor(code: OrderDetailsErrorCode) { super(code); this.code = code; }
}

function proportionalDeposit(priceMinor: number, depositRequiredMinor: number, nextPriceMinor: number) {
  if (priceMinor <= 0) return Math.min(depositRequiredMinor, nextPriceMinor);
  const rounded = Number((BigInt(nextPriceMinor) * BigInt(depositRequiredMinor) + BigInt(Math.floor(priceMinor / 2))) / BigInt(priceMinor));
  return Math.min(nextPriceMinor, rounded);
}

function paidMinor(payment: { amountMinor: number; currency: string; appliedAmountMinor?: number | null; appliedCurrency?: string | null }, orderCurrency: string) {
  if (payment.appliedCurrency === orderCurrency && payment.appliedAmountMinor != null) return payment.appliedAmountMinor;
  return payment.currency === orderCurrency ? payment.amountMinor : 0;
}

export async function persistOrderDetails(tx: Prisma.TransactionClient, orderId: string, input: OrderDetailsInput, actorId: string) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
  const order = await tx.order.findFirst({
    where: { id: orderId, archivedAt: null },
    include: {
      items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      payments: { where: { voidedAt: null } },
      productionSlot: true,
    },
  });
  if (!order) throw new OrderDetailsOperationError(ORDER_DETAILS_ERROR.orderNotFound);
  if ((order.notes ?? null) !== input.expectedDescription || order.priceMinor !== input.expectedPriceMinor) {
    throw new OrderDetailsOperationError(ORDER_DETAILS_ERROR.changed);
  }
  if (input.modelImagePath && (order.modelImagePath ?? null) !== input.expectedModelImagePath) {
    throw new OrderDetailsOperationError(ORDER_DETAILS_ERROR.imageChanged);
  }

  const description = input.description.trim();
  if (!description) throw new OrderDetailsOperationError(ORDER_DETAILS_ERROR.descriptionRequired);
  const depositRequiredMinor = proportionalDeposit(order.priceMinor, order.depositRequiredMinor, input.priceMinor);
  const totalPaid = order.payments.reduce((sum, payment) => sum + paidMinor(payment, order.currency), 0);
  const calculatedPaymentStatus = totalPaid === 0 ? PaymentStatus.UNPAID : totalPaid >= input.priceMinor ? PaymentStatus.PAID : totalPaid >= depositRequiredMinor ? PaymentStatus.DEPOSIT_PAID : PaymentStatus.PARTIALLY_PAID;
  const paymentStatus = order.paymentStatus === PaymentStatus.REFUNDED || order.paymentStatus === PaymentStatus.CANCELLED ? order.paymentStatus : calculatedPaymentStatus;
  const terminalPaymentStatus = order.paymentStatus === PaymentStatus.REFUNDED || order.paymentStatus === PaymentStatus.CANCELLED;
  const confirmsProductionSlot = Boolean(!terminalPaymentStatus && order.productionSlot?.tentative && depositRequiredMinor > 0 && totalPaid >= depositRequiredMinor);
  if (order.productionSlot && !order.productionSlot.tentative && input.priceMinor > order.priceMinor && totalPaid < depositRequiredMinor) {
    throw new OrderDetailsOperationError(ORDER_DETAILS_ERROR.depositWouldUnconfirmProduction);
  }
  const orderData = {
    notes: description,
    priceMinor: input.priceMinor,
    depositRequiredMinor,
    paymentStatus,
    ...(input.modelImagePath ? { modelImagePath: input.modelImagePath } : {}),
    ...(confirmsProductionSlot && order.productionStatus === ProductionStatus.NOT_SCHEDULED ? { productionStatus: ProductionStatus.SCHEDULED } : {}),
  };

  const primaryItem = order.items[0];
  if (primaryItem && (order.items.length === 1 || input.modelImagePath)) {
    const itemData = {
      ...(order.items.length === 1 ? { name: description } : {}),
      ...(input.modelImagePath ? { modelImagePath: input.modelImagePath } : {}),
    };
    const updatedItem = await tx.orderItem.update({ where: { id: primaryItem.id }, data: itemData });
    await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "OrderItem", entityId: primaryItem.id, before: { name: primaryItem.name, priceMinor: primaryItem.priceMinor, modelImagePath: primaryItem.modelImagePath }, after: { name: updatedItem.name, priceMinor: updatedItem.priceMinor, modelImagePath: updatedItem.modelImagePath } } });
  }

  const updatedOrder = await tx.order.update({ where: { id: orderId }, data: orderData });
  if (confirmsProductionSlot && order.productionSlot) {
    const slot = await tx.productionSlot.update({ where: { orderId }, data: { tentative: false } });
    await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "ProductionSlot", entityId: slot.id, before: order.productionSlot, after: slot } });
    await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "PRODUCTION_SLOT_CONFIRMED", summary: "Производственный слот подтверждён после изменения цены заказа", metadata: { depositRequiredMinor, paidMinor: totalPaid, currency: order.currency } } });
  }
  await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "ORDER_DETAILS_UPDATED", summary: "Изменены описание, цена или изображение заказа", metadata: { description, priceMinor: input.priceMinor, priceChanged: order.priceMinor !== input.priceMinor, depositRequiredMinor, modelImagePath: input.modelImagePath ?? order.modelImagePath, paymentStatus } } });
  await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "Order", entityId: orderId, before: order, after: updatedOrder } });
  return updatedOrder;
}
