import type { Prisma } from "@prisma/client";

export const productionOrderSelect = {
  id: true,
  number: true,
  notes: true,
  modelImagePath: true,
  externalImageUrl: true,
  requiredDeliveryAt: true,
  productionStatus: true,
  priceMinor: true,
  currency: true,
  productionSlot: true,
  client: { select: { displayName: true, country: true } },
  items: { select: { quantity: true, modelImagePath: true, externalImageUrl: true, athlete: { select: { firstName: true, lastName: true } } } },
} satisfies Prisma.OrderSelect;

export function includeRequestedProductionOrder<T extends { id: string }>(orders: readonly T[], requested?: T | null) {
  if (!requested || orders.some((order) => order.id === requested.id)) return [...orders];
  return [requested, ...orders];
}

type ProductionOrder = Prisma.OrderGetPayload<{ select: typeof productionOrderSelect }>;
export type ProductionOrderRepository = {
  findMany: (query: object) => Promise<ProductionOrder[]>;
  findFirst: (query: object) => Promise<ProductionOrder | null>;
};

const PRODUCTION_RESULT_LIMIT = 1000;
const MAX_PRODUCTION_RANGE_DAYS = 366;

function productionDate(value: string | undefined, fallback: Date, endOfDay = false) {
  if (!value) return fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("INVALID_PRODUCTION_RANGE");
  const date = new Date(`${value}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error("INVALID_PRODUCTION_RANGE");
  return date;
}

export async function loadProductionOrders(repository: ProductionOrderRepository, orderId?: string, from?: string, to?: string, now = new Date()) {
  const defaultFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const defaultTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 6, 0, 23, 59, 59, 999));
  const startsAt = productionDate(from, defaultFrom);
  const endsAt = productionDate(to, defaultTo, true);
  if (endsAt < startsAt || endsAt.getTime() - startsAt.getTime() > MAX_PRODUCTION_RANGE_DAYS * 24 * 60 * 60 * 1000) throw new Error("INVALID_PRODUCTION_RANGE");
  const orders = await repository.findMany({
    where: { archivedAt: null, salesStatus: { notIn: ["COMPLETED", "CANCELLED"] }, OR: [
      { productionSlot: { is: { startsAt: { lte: endsAt }, endsAt: { gte: startsAt } } } },
      { requiredDeliveryAt: { gte: startsAt, lte: endsAt } },
      { productionSlot: { is: null }, requiredDeliveryAt: null },
    ] },
    orderBy: [{ requiredDeliveryAt: "asc" }, { createdAt: "desc" }],
    take: PRODUCTION_RESULT_LIMIT + 1,
    select: productionOrderSelect,
  });
  if (orders.length > PRODUCTION_RESULT_LIMIT) throw new Error("PRODUCTION_RESULT_LIMIT_EXCEEDED");
  if (!orderId || orders.some((order) => order.id === orderId)) return orders;
  const requested = await repository.findFirst({ where: { id: orderId, archivedAt: null, salesStatus: { notIn: ["COMPLETED", "CANCELLED"] } }, select: productionOrderSelect });
  return includeRequestedProductionOrder(orders, requested);
}
