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

export async function loadProductionOrders(repository: ProductionOrderRepository, orderId?: string) {
  const orders = await repository.findMany({
    where: { archivedAt: null, salesStatus: { notIn: ["COMPLETED", "CANCELLED"] } },
    orderBy: [{ requiredDeliveryAt: "asc" }, { createdAt: "desc" }],
    take: 100,
    select: productionOrderSelect,
  });
  if (!orderId || orders.some((order) => order.id === orderId)) return orders;
  const requested = await repository.findFirst({ where: { id: orderId, archivedAt: null, salesStatus: { notIn: ["COMPLETED", "CANCELLED"] } }, select: productionOrderSelect });
  return includeRequestedProductionOrder(orders, requested);
}
