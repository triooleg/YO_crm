export type ProductionRangeMode = "day" | "week" | "month" | "twoMonths";

export type ProductionSlotView = {
  startsAt: string;
  endsAt: string;
  capacity: number;
  tentative: boolean;
  locked: boolean;
  updatedAt?: string;
};

export type ProductionOrderView = {
  id: string;
  number: string;
  notes?: string;
  modelImagePath?: string;
  externalImageUrl?: string;
  requiredDeliveryAt?: string;
  shippedAt?: string | null;
  deliveredAt?: string | null;
  latestPaymentAt?: string | null;
  hasTrackingNumber: boolean;
  productionStatus: string;
  shippingStatus: string;
  paymentStatus: string;
  priceMinor: number;
  depositRequiredMinor: number;
  paidMinor: number;
  currency: string;
  client: { displayName: string; country?: string };
  items: {
    name?: string;
    quantity: number;
    modelImagePath?: string;
    externalImageUrl?: string;
    athlete?: { firstName: string; lastName?: string };
  }[];
  athlete?: { firstName: string; lastName?: string };
  productionSlot?: ProductionSlotView;
};

export type ProductionFilters = {
  query: string;
  payment: "all" | "unpaid" | "partial" | "deposit" | "paid";
  production: string;
  shipping: "all" | "planned" | "tracking" | "shipped" | "delivered" | "returned" | "lost";
  slot: "all" | "tentative" | "confirmed" | "locked";
  deadline: "all" | "overdue";
};

const DAY_MS = 86_400_000;
const RANGE: Record<ProductionRangeMode, { days: number; dayWidth: number; shiftDays: number }> = {
  day: { days: 14, dayWidth: 56, shiftDays: 7 },
  week: { days: 28, dayWidth: 40, shiftDays: 14 },
  month: { days: 42, dayWidth: 32, shiftDays: 28 },
  twoMonths: { days: 70, dayWidth: 24, shiftDays: 56 },
};

export function productionRange(mode: ProductionRangeMode) {
  return RANGE[mode];
}

export function productionLocalDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function productionAddDays(value: string | Date, amount: number) {
  const date = productionLocalDate(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

export function productionDayDiff(left: string | Date, right: string | Date) {
  return Math.round((productionLocalDate(left).getTime() - productionLocalDate(right).getTime()) / DAY_MS);
}

export function productionIso(value: string | Date) {
  const date = productionLocalDate(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function productionOrderQuantity(order: ProductionOrderView) {
  return order.items.reduce((sum, item) => sum + item.quantity, 0) || 1;
}

export function productionOrderImage(order: ProductionOrderView) {
  const stored = order.items.find((item) => item.modelImagePath)?.modelImagePath || order.modelImagePath;
  return stored ? `/api/orders/images/${stored}` : undefined;
}

export function paymentPresentation(order: Pick<ProductionOrderView, "paidMinor" | "priceMinor" | "depositRequiredMinor" | "paymentStatus">) {
  if (order.paymentStatus === "REFUNDED") return { code: "refunded" as const };
  if (order.paymentStatus === "CANCELLED") return { code: "cancelled" as const };
  if (order.priceMinor > 0 && order.paidMinor >= order.priceMinor) return { code: "paid" as const };
  if (order.depositRequiredMinor > 0 && order.paidMinor >= order.depositRequiredMinor) return { code: "deposit" as const };
  if (order.paidMinor > 0) return { code: "partial" as const };
  return { code: "unpaid" as const };
}

export function shippingPresentation(order: Pick<ProductionOrderView, "requiredDeliveryAt" | "shippedAt" | "deliveredAt" | "hasTrackingNumber" | "shippingStatus">) {
  if (order.shippingStatus === "RETURNED") return { code: "returned" as const, date: order.deliveredAt ? productionIso(order.deliveredAt) : order.shippedAt ? productionIso(order.shippedAt) : order.requiredDeliveryAt ? productionIso(order.requiredDeliveryAt) : null };
  if (order.shippingStatus === "LOST") return { code: "lost" as const, date: order.shippedAt ? productionIso(order.shippedAt) : order.requiredDeliveryAt ? productionIso(order.requiredDeliveryAt) : null };
  if (order.deliveredAt) return { code: "delivered" as const, date: productionIso(order.deliveredAt) };
  if (order.shippedAt) return { code: "shipped" as const, date: productionIso(order.shippedAt) };
  if (order.hasTrackingNumber) return { code: "tracking" as const, date: order.requiredDeliveryAt ? productionIso(order.requiredDeliveryAt) : null };
  if (order.requiredDeliveryAt) return { code: "planned" as const, date: productionIso(order.requiredDeliveryAt) };
  return { code: "none" as const, date: null };
}

export function buildProductionMetrics(orders: ProductionOrderView[], base: Date, days: number, capacityPerDay: number, requiredWindowDays: number) {
  const visibleDays = Array.from({ length: days }, (_, index) => productionAddDays(base, index));
  const scheduled = orders.filter((order) => Boolean(order.productionSlot));
  const dailyLoad = visibleDays.map((day) => scheduled.filter((order) => {
    const slot = order.productionSlot!;
    return day >= productionLocalDate(slot.startsAt) && day <= productionLocalDate(slot.endsAt);
  }).length);
  const depositReceived = orders.filter((order) => {
    const payment = paymentPresentation(order).code;
    return payment === "deposit" || payment === "paid";
  }).length;
  const awaitingPayment = orders.length - depositReceived;
  const averagePercent = days ? Math.round(dailyLoad.reduce((sum, value) => sum + value, 0) / days / capacityPerDay * 100) : 0;
  const peakPercent = Math.round(Math.max(0, ...dailyLoad) / capacityPerDay * 100);
  let nextWindow: string | null = null;
  for (let start = 0; start + requiredWindowDays <= dailyLoad.length; start++) {
    if (dailyLoad.slice(start, start + requiredWindowDays).every((value) => value < capacityPerDay)) {
      nextWindow = productionIso(visibleDays[start]!);
      break;
    }
  }
  return { total: orders.length, scheduled: scheduled.length, depositReceived, awaitingPayment, dailyLoad, averagePercent, peakPercent, nextWindow };
}

export function orderMatchesProductionFilters(order: ProductionOrderView, filters: ProductionFilters, today: Date = new Date()) {
  const payment = paymentPresentation(order).code;
  const shipping = shippingPresentation(order).code;
  const slotState = order.productionSlot?.locked ? "locked" : order.productionSlot?.tentative ? "tentative" : order.productionSlot ? "confirmed" : "none";
  const haystack = [order.number, order.client.displayName, order.client.country, order.notes, ...order.items.map((item) => item.name)].filter(Boolean).join(" ").toLocaleLowerCase();
  const queryMatches = haystack.includes(filters.query.trim().toLocaleLowerCase());
  const paymentMatches = filters.payment === "all" || payment === filters.payment;
  const productionMatches = filters.production === "all" || order.productionStatus === filters.production;
  const shippingMatches = filters.shipping === "all" || shipping === filters.shipping;
  const slotMatches = filters.slot === "all" || slotState === filters.slot;
  const overdue = Boolean(order.requiredDeliveryAt) && productionLocalDate(order.requiredDeliveryAt!) < productionLocalDate(today) && !["shipped", "delivered", "returned"].includes(shipping);
  const deadlineMatches = filters.deadline === "all" || overdue;
  return queryMatches && paymentMatches && productionMatches && shippingMatches && slotMatches && deadlineMatches;
}
