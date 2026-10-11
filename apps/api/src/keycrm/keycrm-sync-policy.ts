import { OrderType } from "@prisma/client";

function defaultDepositRequired(priceMinor: number, type: OrderType) {
  return type === OrderType.READY_MODEL || type === OrderType.ACCESSORY ? 0 : Math.round(priceMinor / 2);
}

export function nextDepositRequired(existingDeposit: number, existingPrice: number, existingType: OrderType, importedDeposit: number) {
  return existingDeposit === defaultDepositRequired(existingPrice, existingType) ? importedDeposit : existingDeposit;
}

export function hasUsableDeliveryAddress(addressLine1: string | null) {
  return Boolean(addressLine1?.trim());
}

export function normalizedPhoneDigits(phone: string | null) {
  const digits = phone?.replace(/[^0-9]/g, "") ?? "";
  return digits.length >= 7 ? digits : null;
}

export function matchedShippingCarrier(serviceName: string | null): "NOVA_POSHTA" | "NOVA_GLOBAL" | "UKRPOSHTA" | "DHL" | null {
  const normalized = serviceName?.trim().toLowerCase().replace(/[._-]+/g, " ") ?? "";
  if (!normalized) return null;
  if (/(nova|нова)\s*(poshta|пошта).*global|nova\s*global/.test(normalized)) return "NOVA_GLOBAL";
  if (/(nova|нова)\s*(poshta|пошта)/.test(normalized)) return "NOVA_POSHTA";
  if (/ukr\s*poshta|ukrposhta|укр\s*пошта/.test(normalized)) return "UKRPOSHTA";
  if (/\bdhl\b/.test(normalized)) return "DHL";
  return null;
}
