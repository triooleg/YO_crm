import type { Prisma } from "@prisma/client";

export const ORDER_MODEL_IMAGE_ROLES = ["OWNER", "ADMIN", "MANAGER"] as const;

export const ORDER_MODEL_IMAGE_ERROR = {
  orderNotFound: "ORDER_MODEL_IMAGE_ORDER_NOT_FOUND",
  itemNotFound: "ORDER_MODEL_IMAGE_ITEM_NOT_FOUND",
  changed: "ORDER_MODEL_IMAGE_CHANGED",
} as const;

type OrderModelImageErrorCode = (typeof ORDER_MODEL_IMAGE_ERROR)[keyof typeof ORDER_MODEL_IMAGE_ERROR];

export type OrderModelImageInput = {
  itemId?: string;
  modelImagePath: string;
  expectedModelImagePath: string | null;
};

export class OrderModelImageOperationError extends Error {
  readonly code: OrderModelImageErrorCode;

  constructor(code: OrderModelImageErrorCode) {
    super(code);
    this.code = code;
  }
}

export async function persistOrderModelImage(
  tx: Prisma.TransactionClient,
  orderId: string,
  input: OrderModelImageInput,
  actorId: string,
) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
  const order = await tx.order.findFirst({
    where: { id: orderId, archivedAt: null },
    include: { items: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] } },
  });
  if (!order) throw new OrderModelImageOperationError(ORDER_MODEL_IMAGE_ERROR.orderNotFound);

  const item = input.itemId ? order.items.find((candidate) => candidate.id === input.itemId) : undefined;
  if (order.items.length && !item) throw new OrderModelImageOperationError(ORDER_MODEL_IMAGE_ERROR.itemNotFound);
  const currentModelImagePath = item ? item.modelImagePath ?? null : order.modelImagePath ?? null;
  if (currentModelImagePath !== input.expectedModelImagePath) {
    throw new OrderModelImageOperationError(ORDER_MODEL_IMAGE_ERROR.changed);
  }

  if (item) {
    const updatedItem = await tx.orderItem.update({ where: { id: item.id }, data: { modelImagePath: input.modelImagePath } });
    await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "OrderItem", entityId: item.id, before: { modelImagePath: item.modelImagePath }, after: { modelImagePath: updatedItem.modelImagePath } } });
  }

  const isPrimary = !order.items.length || order.items[0]?.id === item?.id;
  if (isPrimary) {
    const updatedOrder = await tx.order.update({ where: { id: orderId }, data: { modelImagePath: input.modelImagePath } });
    await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "Order", entityId: orderId, before: { modelImagePath: order.modelImagePath }, after: { modelImagePath: updatedOrder.modelImagePath } } });
  }

  await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "ORDER_MODEL_IMAGE_UPDATED", summary: item ? "Изменено изображение позиции заказа" : "Изменено изображение заказа", metadata: { itemId: item?.id ?? null, modelImagePath: input.modelImagePath, primary: isPrimary } } });
  return { orderId, itemId: item?.id ?? null, modelImagePath: input.modelImagePath, primary: isPrimary };
}
