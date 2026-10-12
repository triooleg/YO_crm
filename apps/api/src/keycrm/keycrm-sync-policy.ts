import { OrderType } from "@prisma/client";

function defaultDepositRequired(priceMinor: number, type: OrderType) {
  return new Set<OrderType>([OrderType.READY_MODEL, OrderType.ACCESSORY, OrderType.WEBSITE_SALE, OrderType.STOCK_SALE]).has(type) ? 0 : Math.round(priceMinor / 2);
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

export function keycrmCostumeCount(items: ReadonlyArray<{ quantity: number }>) {
  return items.reduce((total, item) => {
    if (!Number.isInteger(item.quantity) || item.quantity < 1) {
      throw new Error("Количество костюмов KeyCRM должно быть положительным целым числом");
    }
    return total + item.quantity;
  }, 0);
}

export function keycrmProductionDurationDays(costumeCount: number) {
  if (!Number.isInteger(costumeCount) || costumeCount < 1) {
    throw new Error("Для расчёта производства нужен хотя бы один костюм");
  }
  if (costumeCount === 1) return 6;
  return 8 + (costumeCount - 2) * 3;
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
