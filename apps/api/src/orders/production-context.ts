import type { OrderType, Prisma } from "@prisma/client";
import { appliedPaymentMinor } from "../finance/exchange-rates";

const NON_PRODUCTION_ORDER_TYPES: OrderType[] = ["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"];

export const productionOrderSelect = {
  id: true,
  number: true,
  notes: true,
  modelImagePath: true,
  externalImageUrl: true,
  requiredDeliveryAt: true,
  deliveryTrackingCode: true,
  productionStatus: true,
  salesStatus: true,
  shippingStatus: true,
  priceMinor: true,
  depositRequiredMinor: true,
  paymentStatus: true,
  currency: true,
  productionSlot: true,
  payments: {
    where: { voidedAt: null },
    orderBy: { receivedAt: "asc" },
    select: { amountMinor: true, currency: true, appliedAmountMinor: true, appliedCurrency: true, receivedAt: true },
  },
  shipment: { select: { trackingNumber: true, shippedAt: true, deliveredAt: true } },
  orderShipments: { where:{archivedAt:null}, orderBy:[{isPrimary:"desc" as const},{createdAt:"asc" as const}], select:{trackingNumber:true,shippedAt:true,deliveredAt:true} },
  client: { select: { displayName: true, country: true } },
  items: { select: { name: true, quantity: true, modelImagePath: true, externalImageUrl: true, athlete: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.OrderSelect;

export function includeRequestedProductionOrder<T extends { id: string }>(orders: readonly T[], requested?: T | null) {
  if (!requested || orders.some((order) => order.id === requested.id)) return [...orders];
  return [requested, ...orders];
}

type ProductionOrder = Prisma.OrderGetPayload<{ select: typeof productionOrderSelect }>;
type ProductionOrderView = Omit<ProductionOrder, "deliveryTrackingCode" | "payments" | "shipment" | "orderShipments"> & {
  hasTrackingNumber: boolean;
  paidMinor: number;
  latestPaymentAt: Date | null;
  shippedAt: Date | null;
  deliveredAt: Date | null;
};
export type ProductionOrderRepository = {
  findMany: (query: object) => Promise<ProductionOrder[]>;
  findFirst: (query: object) => Promise<ProductionOrder | null>;
};

function presentProductionOrder(order: ProductionOrder): ProductionOrderView {
  const { deliveryTrackingCode, payments, shipment, ...safeOrder } = order;
  const { orderShipments = [], ...safeOrderWithoutShipments } = safeOrder;
  const activePayments = payments ?? [];
  const appliedPayments = activePayments.map((payment) => ({ payment, appliedMinor: appliedPaymentMinor(payment, order.currency) }));
  const paidMinor = appliedPayments.reduce((sum, entry) => sum + entry.appliedMinor, 0);
  let latestPaymentAt: Date | null = null;
  for (let index = appliedPayments.length - 1; index >= 0; index--) {
    if (appliedPayments[index]!.appliedMinor > 0) { latestPaymentAt = appliedPayments[index]!.payment.receivedAt; break; }
  }
  const legacyShipmentProjection = {
    hasTrackingNumber: Boolean(shipment?.trackingNumber?.trim() || deliveryTrackingCode?.trim()),
  };
  return {
    ...safeOrderWithoutShipments,
    hasTrackingNumber: orderShipments.some((parcel) => parcel.trackingNumber?.trim()) || legacyShipmentProjection.hasTrackingNumber,
    paidMinor,
    latestPaymentAt,
    shippedAt: orderShipments.length>0?orderShipments.find(parcel=>parcel.shippedAt)?.shippedAt??null:shipment?.shippedAt??null,
    deliveredAt: orderShipments.length>0?(orderShipments.every(parcel=>parcel.deliveredAt)?orderShipments.reduce<Date|null>((latest,parcel)=>!latest||parcel.deliveredAt!>latest?parcel.deliveredAt!:latest,null):null):shipment?.deliveredAt??null,
  };
}

const PRODUCTION_RESULT_LIMIT = 1000;
const MAX_PRODUCTION_RANGE_DAYS = 366;

function productionDate(value: string | undefined, fallback: Date, endOfDay = false) {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_PRODUCTION_RANGE");
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("INVALID_PRODUCTION_RANGE");
  return date;
}

export async function loadProductionOrders(repository: ProductionOrderRepository, orderId?: string, from?: string, to?: string, now = new Date(), overview?: { orderIds: string[] }) {
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 6, 0, 23, 59, 59, 999));
  const startsAt = productionDate(from, defaultFrom);
  const endsAt = productionDate(to, defaultTo, true);
  if (endsAt < startsAt || endsAt.getTime() - startsAt.getTime() > MAX_PRODUCTION_RANGE_DAYS * 24 * 60 * 60 * 1000) throw new Error("INVALID_PRODUCTION_RANGE");
  const orders = await repository.findMany({
    where: { archivedAt: null, type: { notIn: NON_PRODUCTION_ORDER_TYPES }, salesStatus: { notIn: ["COMPLETED", "CANCELLED"] }, ...(overview ? { id: { in: overview.orderIds } } : { OR: [
      { productionSlot: { is: { startsAt: { lte: endsAt }, endsAt: { gte: startsAt } } } },
      { requiredDeliveryAt: { gte: startsAt, lte: endsAt } },
      { productionSlot: { is: null }, requiredDeliveryAt: null },
    ] }) },
    orderBy: [{ requiredDeliveryAt: "asc" }, { createdAt: "desc" }],
    take: PRODUCTION_RESULT_LIMIT + 1,
    select: productionOrderSelect,
  });
  if (orders.length > PRODUCTION_RESULT_LIMIT) throw new Error("PRODUCTION_RESULT_LIMIT_EXCEEDED");
  if (overview || !orderId || orders.some((order) => order.id === orderId)) return orders.map(presentProductionOrder);
  const requested = await repository.findFirst({ where: { id: orderId, archivedAt: null, type: { notIn: NON_PRODUCTION_ORDER_TYPES }, salesStatus: { notIn: ["COMPLETED", "CANCELLED"] } }, select: productionOrderSelect });
  return includeRequestedProductionOrder(orders, requested).map(presentProductionOrder);
}
