import type { Prisma } from "@prisma/client";

export const ORDER_DELIVERY_ADDRESS_ROLES = ["OWNER", "ADMIN", "MANAGER"] as const;

export const DELIVERY_ADDRESS_ERROR = {
  addressRequired: "ORDER_DELIVERY_ADDRESS_REQUIRED",
  recipientRequired: "ORDER_DELIVERY_RECIPIENT_REQUIRED",
  orderNotFound: "ORDER_DELIVERY_ORDER_NOT_FOUND",
} as const;

type DeliveryAddressErrorCode = (typeof DELIVERY_ADDRESS_ERROR)[keyof typeof DELIVERY_ADDRESS_ERROR];

export type DeliveryAddressInput = {
  useClientAddress: boolean;
  recipientMatchesClient: boolean;
  recipient?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
  country?: string | null;
  addressText?: string | null;
};

export type DeliveryClient = {
  displayName: string;
  address?: string | null;
  city?: string | null;
  postalCode?: string | null;
  country?: string | null;
};

export type StoredDeliveryAddress = {
  deliveryAddressSet: boolean;
  deliveryRecipient: string | null;
  deliveryAddressLine1: string | null;
  deliveryAddressLine2: string | null;
  deliveryCity: string | null;
  deliveryRegion: string | null;
  deliveryPostalCode: string | null;
  country: string | null;
  deliveryAddressText: string | null;
};

export class DeliveryAddressOperationError extends Error {
  readonly code: DeliveryAddressErrorCode;

  constructor(code: DeliveryAddressErrorCode) {
    super(code);
    this.code = code;
  }
}

const clean = (value?: string | null) => value?.trim() || null;
const composeAddress = (...parts: Array<string | null | undefined>) => parts.map(clean).filter((value): value is string => Boolean(value)).join(", ") || null;

export function resolveDeliveryAddress(input: DeliveryAddressInput, client: DeliveryClient): Omit<StoredDeliveryAddress, "deliveryAddressSet"> {
  if (input.useClientAddress) {
    const addressLine1 = clean(client.address);
    if (!addressLine1) throw new DeliveryAddressOperationError(DELIVERY_ADDRESS_ERROR.addressRequired);
    return {
      deliveryRecipient: clean(client.displayName),
      deliveryAddressLine1: addressLine1,
      deliveryAddressLine2: null,
      deliveryCity: clean(client.city),
      deliveryRegion: null,
      deliveryPostalCode: clean(client.postalCode),
      country: clean(client.country),
      deliveryAddressText: composeAddress(client.address, client.city, client.postalCode, client.country),
    };
  }

  const recipient = input.recipientMatchesClient ? clean(client.displayName) : clean(input.recipient);
  if (!recipient) throw new DeliveryAddressOperationError(DELIVERY_ADDRESS_ERROR.recipientRequired);
  const addressLine1 = clean(input.addressLine1);
  const explicitAddressText = clean(input.addressText);
  if (!addressLine1 && !explicitAddressText) throw new DeliveryAddressOperationError(DELIVERY_ADDRESS_ERROR.addressRequired);
  const addressText = addressLine1
    ? composeAddress(input.addressLine1, input.addressLine2, input.city, input.region, input.postalCode, input.country)
    : explicitAddressText;

  return {
    deliveryRecipient: recipient,
    deliveryAddressLine1: addressLine1,
    deliveryAddressLine2: clean(input.addressLine2),
    deliveryCity: clean(input.city),
    deliveryRegion: clean(input.region),
    deliveryPostalCode: clean(input.postalCode),
    country: clean(input.country),
    deliveryAddressText: addressText,
  };
}

export function resolveExistingDeliveryAddress(order: StoredDeliveryAddress, client: DeliveryClient): StoredDeliveryAddress {
  if (order.deliveryAddressSet) return { ...order };
  return {
    deliveryAddressSet: false,
    deliveryRecipient: clean(client.displayName),
    deliveryAddressLine1: clean(client.address),
    deliveryAddressLine2: null,
    deliveryCity: clean(client.city),
    deliveryRegion: null,
    deliveryPostalCode: clean(client.postalCode),
    country: clean(order.country) ?? clean(client.country),
    deliveryAddressText: composeAddress(client.address, client.city, client.postalCode, order.country ?? client.country),
  };
}

export async function persistOrderDeliveryAddress(
  tx: Prisma.TransactionClient,
  orderId: string,
  input: DeliveryAddressInput,
  actorId: string,
) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
  const order = await tx.order.findFirst({
    where: { id: orderId, archivedAt: null },
    include: { client: { select: { displayName: true, country: true, city: true, address: true, postalCode: true } } },
  });
  if (!order) throw new DeliveryAddressOperationError(DELIVERY_ADDRESS_ERROR.orderNotFound);

  const before = resolveExistingDeliveryAddress({
    deliveryAddressSet: order.deliveryAddressSet,
    deliveryRecipient: order.deliveryRecipient,
    deliveryAddressLine1: order.deliveryAddressLine1,
    deliveryAddressLine2: order.deliveryAddressLine2,
    deliveryCity: order.deliveryCity,
    deliveryRegion: order.deliveryRegion,
    deliveryPostalCode: order.deliveryPostalCode,
    country: order.country,
    deliveryAddressText: order.deliveryAddressText,
  }, order.client);
  const delivery = resolveDeliveryAddress(input, order.client);
  const updated = await tx.order.update({ where: { id: orderId }, data: { deliveryAddressSet: true, ...delivery } });
  const after = { ...delivery, deliveryAddressSet: true };
  await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "ORDER_DELIVERY_ADDRESS_UPDATED", summary: "Обновлён адрес доставки заказа", metadata: { useClientAddress: input.useClientAddress, recipientMatchesClient: input.recipientMatchesClient } } });
  await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "Order", entityId: orderId, before, after } });
  return updated;
}
