import type { OrderType } from "@prisma/client";

export const DEFAULT_PRODUCTION_DURATION_DAYS = 7;
export const DEFAULT_SHIPPING_LEAD_DAYS = 2;
const DAY_MS = 86_400_000;

export function requiresProduction(type: OrderType) {
  return !["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"].includes(type);
}

export function subtractUtcDays(value: Date, days: number) {
  return new Date(value.getTime() - days * DAY_MS);
}

export function productionSetting(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function productionWindow(requiredDeliveryAt: Date, durationDays: number, shippingLeadDays: number) {
  const endsAt = subtractUtcDays(requiredDeliveryAt, shippingLeadDays);
  return { startsAt: subtractUtcDays(endsAt, durationDays - 1), endsAt };
}

export function violatesShippingLead(endsAt: Date, requiredDeliveryAt: Date, shippingLeadDays: number) {
  return endsAt > subtractUtcDays(requiredDeliveryAt, shippingLeadDays);
}

export function resolveProductionSlotTentative(paidMinor: number, depositRequiredMinor: number, requested?: boolean) {
  return paidMinor >= depositRequiredMinor ? false : requested ?? true;
}
