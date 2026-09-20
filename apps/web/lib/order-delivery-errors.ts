export type OrderDeliveryErrorMessages = {
  addressRequired: string;
  recipientRequired: string;
  orderNotFound: string;
};

const deliveryErrorKey = {
  ORDER_DELIVERY_ADDRESS_REQUIRED: "addressRequired",
  ORDER_DELIVERY_RECIPIENT_REQUIRED: "recipientRequired",
  ORDER_DELIVERY_ORDER_NOT_FOUND: "orderNotFound",
} as const;

export function orderDeliveryErrorMessage(code: unknown, messages: OrderDeliveryErrorMessages) {
  if (typeof code !== "string" || !(code in deliveryErrorKey)) return undefined;
  return messages[deliveryErrorKey[code as keyof typeof deliveryErrorKey]];
}
