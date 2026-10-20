export type OrderDeliveryAddressState = {
  deliveryAddressSet?: boolean;
  deliveryAddressLine1?: string | null;
  deliveryAddressText?: string | null;
  client: { address?: string | null };
};

const present = (value?: string | null) => Boolean(value?.trim());

export function hasUsableDeliveryAddress(order: OrderDeliveryAddressState) {
  if (!order.deliveryAddressSet) return present(order.client.address);
  return present(order.deliveryAddressLine1) || present(order.deliveryAddressText);
}
