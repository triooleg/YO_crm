export type ProductionRangeMode = "day" | "week" | "month" | "twoMonths";
export type ProductionSortMode = "schedule" | "shippingProximity";

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
  dispatchComplete?: boolean;
  deliveryComplete?: boolean;
  partiallyShipped?: boolean;
  productionStatus: string;
  salesStatus?: string;
  shippingStatus: string;
  paymentStatus: string;
  priceMinor: number;
  depositRequiredMinor: number;
  paidMinor: number;
  paymentSettlementKnown?: boolean;
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

export function paymentPresentation(order: Pick<ProductionOrderView, "paidMinor" | "priceMinor" | "depositRequiredMinor" | "paymentStatus" | "paymentSettlementKnown">) {
  if (order.paymentStatus === "REFUNDED") return { code: "refunded" as const };
  if (order.paymentStatus === "CANCELLED") return { code: "cancelled" as const };
  if (order.paymentSettlementKnown === false) return { code: "unknown" as const };
  if (order.priceMinor > 0 && order.paidMinor >= order.priceMinor) return { code: "paid" as const };
  if (order.depositRequiredMinor > 0 && order.paidMinor >= order.depositRequiredMinor) return { code: "deposit" as const };
  if (order.paidMinor > 0) return { code: "partial" as const };
  return { code: "unpaid" as const };
}

export function shippingPresentation(order: Pick<ProductionOrderView, "requiredDeliveryAt" | "shippedAt" | "deliveredAt" | "hasTrackingNumber" | "shippingStatus" | "salesStatus" | "dispatchComplete" | "deliveryComplete">) {
  if (order.shippingStatus === "RETURNED") return { code: "returned" as const, date: order.deliveredAt ? productionIso(order.deliveredAt) : order.shippedAt ? productionIso(order.shippedAt) : null };
  if (order.shippingStatus === "LOST") return { code: "lost" as const, date: order.shippedAt ? productionIso(order.shippedAt) : null };
  if (order.dispatchComplete !== false && order.deliveryComplete !== false && (order.deliveredAt || order.shippingStatus === "DELIVERED" || order.salesStatus === "DELIVERED")) return { code: "delivered" as const, date: order.deliveredAt ? productionIso(order.deliveredAt) : null };
  // Approved production presentation: a tracking number also means dispatched.
  // Stored statuses and factual timestamps remain independent and unchanged.
  if (order.dispatchComplete !== false && (order.dispatchComplete || order.shippedAt || ["SHIPPED", "IN_TRANSIT"].includes(order.shippingStatus) || order.salesStatus === "SHIPPED" || order.hasTrackingNumber)) return { code: "shipped" as const, date: order.shippedAt ? productionIso(order.shippedAt) : null };
  if (order.requiredDeliveryAt) return { code: "planned" as const, date: productionIso(order.requiredDeliveryAt) };
  return { code: "none" as const, date: null };
}

export function productionOrderIsShipped(order: Pick<ProductionOrderView, "shippedAt" | "deliveredAt" | "shippingStatus" | "salesStatus" | "hasTrackingNumber" | "dispatchComplete">) {
  return order.dispatchComplete !== false && ["shipped", "delivered", "returned", "lost"].includes(shippingPresentation(order).code);
}

/** Adapt the existing Orders projection to the shared presentation; never write a status. */
export function hasDatedProductionSlot(order: { productionSlot?: { startsAt?: string; endsAt?: string } | null }) {
  const slot = order.productionSlot;
  if (!slot?.startsAt || !slot.endsAt) return false;
  const start = Date.parse(slot.startsAt), end = Date.parse(slot.endsAt);
  return Number.isFinite(start) && Number.isFinite(end) && start <= end;
}

export function productionStatusForDisplay(order: { productionStatus: string; productionSlot?: { startsAt?: string; endsAt?: string; tentative?: boolean } | null }) {
  return order.productionStatus === "NOT_SCHEDULED" && hasDatedProductionSlot(order) ? "SCHEDULED" : order.productionStatus;
}

export function orderProductionStatusPresentation(order: {
  productionStatus: string;
  shippingStatus: string;
  salesStatus?: string;
  deliveryTrackingCode?: string;
  productionSlot?: { startsAt?: string; endsAt?: string; tentative?: boolean } | null;
  shipment?: { trackingNumber?: string; shippedAt?: string; deliveredAt?: string };
  orderShipments?: Array<{id:string;status:string;trackingNumber?:string|null;shippedAt?:string|null;deliveredAt?:string|null;instances?:Array<{id:string}>}>;
  items?:Array<{quantity?:number;instances?:Array<{id:string;productionStatus?:string}>}>;
}) {
  const childFacts=order.orderShipments?.length?orderTimelinePresentation(order):null;
  if(childFacts?.partial)return {domain:"production" as const,status:productionStatusForDisplay(order)};
  const shipping = shippingPresentation({
    shippingStatus: childFacts?.shippingStatus??order.shippingStatus,
    salesStatus: order.salesStatus,
    hasTrackingNumber: Boolean(order.shipment?.trackingNumber?.trim() || order.deliveryTrackingCode?.trim()),
    shippedAt: order.shipment?.shippedAt,
    deliveredAt: childFacts&&childFacts.shippingStatus!=='DELIVERED'?undefined:order.shipment?.deliveredAt,
    ...(childFacts?{dispatchComplete:childFacts.dispatched,deliveryComplete:childFacts.shippingStatus==='DELIVERED'}:{}),
  });
  const statuses = { shipped: "SHIPPED", delivered: "DELIVERED", returned: "RETURNED", lost: "LOST" } as const;
  if (shipping.code in statuses) return { domain: "shipping" as const, status: statuses[shipping.code as keyof typeof statuses] };
  return { domain: "production" as const, status: productionStatusForDisplay(order) };
}

export function orderReadyToShip(order: Parameters<typeof orderProductionStatusPresentation>[0]) {
  if (["COMPLETED", "CANCELLED"].includes(order.salesStatus ?? "")) return false;
  if (orderProductionStatusPresentation(order).domain === "shipping") return false;
  if (order.orderShipments?.some(parcel=>parcel.status!=='CANCELLED'&&(['SHIPPED','IN_TRANSIT','DELIVERED','LOST','RETURNED'].includes(parcel.status)||parcel.trackingNumber?.trim()||parcel.shippedAt||parcel.deliveredAt))) return false;
  return order.salesStatus === "READY_TO_SHIP" || order.shippingStatus === "READY" || order.productionStatus === "READY";
}

/** Read-only timeline facts; parcel tracking is not proof that unassigned items shipped. */
export function orderTimelinePresentation(order: Parameters<typeof orderProductionStatusPresentation>[0] & {
  orderShipments?: Array<{ id: string; status: string; trackingNumber?: string | null; shippedAt?: string | null; deliveredAt?: string | null; instances?: Array<{ id: string }> }>;
  items?: Array<{ quantity?: number; instances?: Array<{ id: string; productionStatus?: string }> }>;
}) {
  const factualDate = (value?: string | null) => value && Number.isFinite(Date.parse(value)) ? value : null;
  const legacyTracking = order.shipment?.trackingNumber?.trim() || order.deliveryTrackingCode?.trim() || "";
  const parcels = (order.orderShipments ?? []).filter(parcel => parcel.status !== "CANCELLED");
  const sent = parcels.filter(parcel => Boolean(parcel.trackingNumber?.trim() || factualDate(parcel.shippedAt) || factualDate(parcel.deliveredAt)) || ["SHIPPED", "IN_TRANSIT", "DELIVERED", "RETURNED", "LOST"].includes(parcel.status));
  const covered = new Set(sent.flatMap(parcel => (parcel.instances ?? []).map(instance => instance.id)));
  const instances = (order.items ?? []).flatMap(item => item.instances ?? []).filter(instance => instance.productionStatus !== "CANCELLED");
  const knownCohort = Boolean(order.items?.length) && order.items!.every(item => Boolean(item.instances?.length) && (item.quantity === undefined || item.instances!.length === item.quantity))
    && instances.length > 0 && new Set(instances.map(instance => instance.id)).size === instances.length;
  const allParcelsSent = knownCohort && parcels.length > 0 && sent.length === parcels.length && instances.every(instance => covered.has(instance.id));
  const legacy = shippingPresentation({ shippingStatus: order.shippingStatus, salesStatus: order.salesStatus,
    hasTrackingNumber: Boolean(legacyTracking), shippedAt: factualDate(order.shipment?.shippedAt) ?? undefined,
    deliveredAt: factualDate(order.shipment?.deliveredAt) ?? undefined });
  const legacySent = Boolean(legacyTracking || factualDate(order.shipment?.shippedAt) || factualDate(order.shipment?.deliveredAt) || !parcels.length && ["shipped", "delivered", "returned", "lost"].includes(legacy.code));
  const partial = !legacySent && sent.length > 0 && !allParcelsSent;
  const childException = sent.some(parcel => parcel.status === "LOST") ? "LOST" : sent.some(parcel => parcel.status === "RETURNED") ? "RETURNED" : null;
  const shippingStatus = ["RETURNED","LOST"].includes(order.shippingStatus) ? order.shippingStatus : childException
    ?? (legacySent ? (legacy.code==="delivered"&&parcels.length>0&&!parcels.every(parcel=>parcel.status==="DELIVERED"||factualDate(parcel.deliveredAt))?"SHIPPED":({shipped:"SHIPPED",delivered:"DELIVERED",returned:"RETURNED",lost:"LOST"} as Record<string,string>)[legacy.code]!)
    : allParcelsSent ? (parcels.every(parcel => parcel.status === "DELIVERED" || factualDate(parcel.deliveredAt)) ? "DELIVERED" : "SHIPPED") : order.shippingStatus);
  const parcelDates = sent.map(parcel => factualDate(parcel.shippedAt));
  const shippedAt = factualDate(order.shipment?.shippedAt) || (allParcelsSent && parcelDates.every(Boolean) ? [...parcelDates].sort((a,b)=>Date.parse(a!)-Date.parse(b!)).at(-1)! : null);
  return { shippingStatus, partial, shippedAt, dispatched:legacySent||allParcelsSent,
    productionStatus: productionStatusForDisplay(order),
    trackingNumber: legacyTracking || sent.map(parcel => parcel.trackingNumber?.trim()).find(Boolean) || "",
    productionCompleted: !partial && (order.salesStatus === "COMPLETED" || legacySent || allParcelsSent) && order.productionStatus !== "CANCELLED" };
}

export function orderDeadlineDays(order: { requiredDeliveryAt?: string }, today: Date = new Date()) {
  return order.requiredDeliveryAt ? productionDayDiff(order.requiredDeliveryAt, today) : 9999;
}

export function sortProductionOrdersByShippingProximity(orders: ProductionOrderView[], today: Date = new Date()) {
  const reference = productionLocalDate(today).getTime();
  return orders.map((order, index) => ({ order, index, date: order.shippedAt ? productionIso(order.shippedAt) : order.requiredDeliveryAt ? productionIso(order.requiredDeliveryAt) : null }))
    .sort((left, right) => {
      if (!left.date && !right.date) return left.index - right.index;
      if (!left.date) return 1;
      if (!right.date) return -1;
      const leftTime = productionLocalDate(left.date).getTime();
      const rightTime = productionLocalDate(right.date).getTime();
      return Math.abs(leftTime - reference) - Math.abs(rightTime - reference) || leftTime - rightTime || left.index - right.index;
    })
    .map(({ order }) => order);
}

export function groupProductionOrdersBySchedule(orders: ProductionOrderView[]) {
  return [...orders.filter((order) => order.productionSlot), ...orders.filter((order) => !order.productionSlot)];
}

export function productionSlotTimingPresentation(order: Pick<ProductionOrderView, "productionStatus" | "productionSlot" | "shippedAt" | "deliveredAt" | "shippingStatus" | "salesStatus" | "hasTrackingNumber">, today: Date = new Date()) {
  const slot = order.productionSlot;
  if (!slot) return null;
  const duration = productionDayDiff(slot.endsAt, slot.startsAt) + 1;
  if (order.productionStatus === "READY" || productionOrderIsShipped(order)) return { duration, code: "completed" as const, days: 0 };
  const remaining = productionDayDiff(slot.endsAt, today);
  return remaining >= 0
    ? { duration, code: "remaining" as const, days: remaining }
    : { duration, code: "overdue" as const, days: Math.abs(remaining) };
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
  const paymentUnknown = orders.filter(order => paymentPresentation(order).code === "unknown").length;
  const awaitingPayment = orders.filter(order=>['unpaid','partial'].includes(paymentPresentation(order).code)).length;
  const averagePercent = days ? Math.round(dailyLoad.reduce((sum, value) => sum + value, 0) / days / capacityPerDay * 100) : 0;
  const peakPercent = Math.round(Math.max(0, ...dailyLoad) / capacityPerDay * 100);
  let nextWindow: string | null = null;
  for (let start = 0; start + requiredWindowDays <= dailyLoad.length; start++) {
    if (dailyLoad.slice(start, start + requiredWindowDays).every((value) => value < capacityPerDay)) {
      nextWindow = productionIso(visibleDays[start]!);
      break;
    }
  }
  return { total: orders.length, scheduled: scheduled.length, depositReceived, awaitingPayment, paymentUnknown, dailyLoad, averagePercent, peakPercent, nextWindow };
}

export function orderMatchesProductionFilters(order: ProductionOrderView, filters: ProductionFilters, today: Date = new Date()) {
  const payment = paymentPresentation(order).code;
  const shipping = shippingPresentation(order).code;
  const slotState = order.productionSlot?.locked ? "locked" : order.productionSlot?.tentative ? "tentative" : order.productionSlot ? "confirmed" : "none";
  const haystack = [order.number, order.client.displayName, order.client.country, order.notes, ...order.items.map((item) => item.name)].filter(Boolean).join(" ").toLocaleLowerCase();
  const queryMatches = haystack.includes(filters.query.trim().toLocaleLowerCase());
  const paymentMatches = filters.payment === "all" || payment === filters.payment;
  const productionMatches = filters.production === "all" || productionStatusForDisplay(order) === filters.production;
  const shippingMatches = filters.shipping === "all" || (filters.shipping === "tracking" ? order.hasTrackingNumber : shipping === filters.shipping);
  const slotMatches = filters.slot === "all" || slotState === filters.slot;
  const overdue = Boolean(order.requiredDeliveryAt) && productionLocalDate(order.requiredDeliveryAt!) < productionLocalDate(today) && !["shipped", "delivered", "returned", "lost"].includes(shipping);
  const deadlineMatches = filters.deadline === "all" || overdue;
  return queryMatches && paymentMatches && productionMatches && shippingMatches && slotMatches && deadlineMatches;
}
