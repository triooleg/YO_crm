const MANUAL_ORDER_IMAGE_NAME = /^[a-f0-9-]+\.(jpg|png|webp)$/;
const KEYCRM_ORDER_IMAGE_NAME = /^keycrm-[a-f0-9]{32}\.jpg$/;

export function isOrderImageName(name: string) {
  return MANUAL_ORDER_IMAGE_NAME.test(name) || KEYCRM_ORDER_IMAGE_NAME.test(name);
}
