import { ProductionStatus, type Prisma } from "@prisma/client";

const PLANNING_STATUSES: ProductionStatus[] = [ProductionStatus.NOT_SCHEDULED, ProductionStatus.TENTATIVE, ProductionStatus.SCHEDULED];
const IN_PROGRESS_STATUSES = new Set<ProductionStatus>([ProductionStatus.MATERIALS, ProductionStatus.CUTTING, ProductionStatus.SEWING, ProductionStatus.DECORATION, ProductionStatus.QUALITY_CONTROL]);

export function aggregateProductionStatus(statuses: ProductionStatus[]): ProductionStatus {
  const active = statuses.filter((status) => status !== ProductionStatus.CANCELLED);
  if (!active.length) return statuses.length ? ProductionStatus.CANCELLED : ProductionStatus.NOT_SCHEDULED;
  if (active.every((status) => status === ProductionStatus.READY)) return ProductionStatus.READY;
  if (active.some((status) => IN_PROGRESS_STATUSES.has(status) || status === ProductionStatus.READY)) return ProductionStatus.SEWING;
  if (active.some((status) => status === ProductionStatus.SCHEDULED)) return ProductionStatus.SCHEDULED;
  if (active.some((status) => status === ProductionStatus.TENTATIVE)) return ProductionStatus.TENTATIVE;
  return ProductionStatus.NOT_SCHEDULED;
}

export async function updateProductionStatusGraph(
  tx: Prisma.TransactionClient,
  orderId: string,
  productionStatus: ProductionStatus,
  orderData: Prisma.OrderUpdateInput = {},
  options: { preserveProgress?: boolean } = {},
) {
  const updated = await tx.order.update({ where: { id: orderId }, data: { ...orderData, productionStatus } });
  const planningOnly = options.preserveProgress && PLANNING_STATUSES.includes(productionStatus);
  await tx.orderItem.updateMany({ where: { orderId, archivedAt: null, ...(planningOnly ? { productionStatus: { in: PLANNING_STATUSES } } : {}) }, data: { productionStatus } });
  await tx.orderItemInstance.updateMany({
    where: planningOnly
      ? { orderItem: { orderId, archivedAt: null }, archivedAt: null, productionStatus: { in: PLANNING_STATUSES } }
      : { orderItem: { orderId, archivedAt: null }, archivedAt: null },
    data: { productionStatus },
  });
  return updated;
}
