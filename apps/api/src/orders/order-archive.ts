import type { Prisma } from "@prisma/client";

export const ORDER_ARCHIVE_ERROR = {
  selectionChanged: "ORDER_ARCHIVE_SELECTION_CHANGED",
  emptySelection: "ORDER_ARCHIVE_EMPTY_SELECTION",
} as const;

export class OrderArchiveError extends Error {
  readonly code: (typeof ORDER_ARCHIVE_ERROR)[keyof typeof ORDER_ARCHIVE_ERROR];
  constructor(code: (typeof ORDER_ARCHIVE_ERROR)[keyof typeof ORDER_ARCHIVE_ERROR]) {
    super(code);
    this.code = code;
  }
}

type ArchiveTransaction = Pick<Prisma.TransactionClient, "$executeRawUnsafe" | "order" | "activity" | "auditLog">;

export async function archiveOrdersTransaction(
  tx: ArchiveTransaction,
  orderIds: string[],
  actorId: string,
  archivedAt = new Date(),
) {
  const ids = [...new Set(orderIds)].sort();
  if (!ids.length) throw new OrderArchiveError(ORDER_ARCHIVE_ERROR.emptySelection);

  for (const id of ids) {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", id);
  }

  const orders = await tx.order.findMany({
    where: { id: { in: ids }, archivedAt: null },
    orderBy: { id: "asc" },
    select: { id: true, clientId: true, number: true, archivedAt: true },
  });
  if (orders.length !== ids.length) throw new OrderArchiveError(ORDER_ARCHIVE_ERROR.selectionChanged);

  const updated = await tx.order.updateMany({
    where: { id: { in: ids }, archivedAt: null },
    data: { archivedAt },
  });
  if (updated.count !== ids.length) throw new OrderArchiveError(ORDER_ARCHIVE_ERROR.selectionChanged);

  for (const order of orders) {
    await tx.activity.create({
      data: {
        clientId: order.clientId,
        orderId: order.id,
        type: "ORDER_ARCHIVED",
        summary: `Заказ ${order.number} перемещён в архив`,
        metadata: { archivedAt: archivedAt.toISOString() },
      },
    });
    await tx.auditLog.create({
      data: {
        actorId,
        action: "ARCHIVE",
        entityType: "Order",
        entityId: order.id,
        before: order,
        after: { ...order, archivedAt },
      },
    });
  }

  return { archivedIds: ids, archivedAt: archivedAt.toISOString() };
}
