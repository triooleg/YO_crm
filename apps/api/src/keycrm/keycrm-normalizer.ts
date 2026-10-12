import { ContactChannel, OrderType, PaymentStatus, SalesStatus, ShippingStatus } from "@prisma/client";
import type { KeycrmOrder } from "./keycrm.types";

const SOURCE_SYSTEM = "KEYCRM";

export function keycrmMoneyToMinor(value: unknown) {
  if (value === null || value === undefined || value === "") return 0;
  const text = String(value).trim().replace(",", ".");
  const match = text.match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) throw new Error(`Некорректная денежная сумма KeyCRM: ${text}`);
  if ((match[3]?.slice(2) ?? "").replace(/0/g, "")) {
    throw new Error(`Денежная сумма KeyCRM содержит более двух знаков после запятой: ${text}`);
  }
  const fraction = `${match[3] ?? ""}00`.slice(0, 2);
  const minor = BigInt(match[2]!) * 100n + BigInt(fraction);
  const signed = match[1] ? -minor : minor;
  if (signed > BigInt(Number.MAX_SAFE_INTEGER) || signed < BigInt(Number.MIN_SAFE_INTEGER)) throw new Error("Сумма KeyCRM выходит за безопасный диапазон");
  return Number(signed);
}

export function keycrmRequiredMoneyToMinor(value: unknown, label: string, allowZero = true) {
  if (value === null || value === undefined || value === "") throw new Error(`${label} не передана KeyCRM`);
  const amount = keycrmMoneyToMinor(value);
  if (amount < 0 || (!allowZero && amount === 0)) throw new Error(`${label} должна быть ${allowZero ? "неотрицательной" : "положительной"}`);
  return amount;
}

export function keycrmDate(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value.trim()) ? `${value.trim().replace(" ", "T")}Z` : value.trim();
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) throw new Error(`Некорректная дата KeyCRM: ${value}`);
  return parsed;
}

function first(value: string | string[] | null | undefined) {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function normalizedEmail(value: string | string[] | null | undefined) {
  return first(value)?.toLowerCase() ?? null;
}

function normalizedPhone(value: string | string[] | null | undefined) {
  const candidate = first(value);
  if (!candidate) return null;
  const compact = candidate.replace(/[\s().-]/g, "");
  if (/^00\d{7,15}$/.test(compact)) return `+${compact.slice(2)}`;
  return /^\+?\d{7,15}$/.test(compact) ? compact : candidate;
}

export function keycrmSourceChannel(name: string | undefined): ContactChannel {
  const value = (name ?? "").toLowerCase();
  if (value.includes("instagram")) return "INSTAGRAM";
  if (value.includes("facebook")) return "FACEBOOK";
  if (value.includes("whatsapp") || value.includes("whatapp")) return "WHATSAPP";
  if (value.includes("email") || value.includes("mail")) return "EMAIL";
  if (value.includes("сайт") || value.includes("site") || value.includes("yoleotard")) return "WEBSITE";
  return "OTHER";
}

function paymentStatus(value: string | null | undefined): PaymentStatus {
  if (value === "paid" || value === "overpaid") return "PAID";
  if (value === "part_paid") return "PARTIALLY_PAID";
  return "UNPAID";
}

function salesStatus(status?: KeycrmOrder["status"]): SalesStatus {
  void status;
  return "NEW_LEAD";
}

function shippingStatus(shipping: KeycrmOrder["shipping"]): ShippingStatus {
  void shipping;
  return "NOT_READY";
}

function itemExternalId(orderId: number, item: NonNullable<KeycrmOrder["products"]>[number], index: number) {
  const providerId = item.id;
  void index;
  return providerId ? `${orderId}:${providerId}` : null;
}

function itemQuantity(value: unknown) {
  const quantity = Number(value ?? 1);
  if (!Number.isInteger(quantity) || quantity < 1) {
    throw new Error(`Количество товара KeyCRM должно быть целым положительным числом: ${String(value)}`);
  }
  return quantity;
}

function externalImageUrl(value: unknown): string | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const picture = value as { url?: unknown; original_file_url?: unknown; thumbnail?: unknown };
    return externalImageUrl(picture.url) ?? externalImageUrl(picture.original_file_url) ?? externalImageUrl(picture.thumbnail);
  }
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function currencyCode(value: unknown, label: string) {
  const currency = typeof value === "string" ? value.trim().toUpperCase() : "";
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`${label} должна содержать трёхбуквенный код ISO 4217`);
  return currency;
}

function customFieldDate(fields: KeycrmOrder["custom_fields"], uuid: string | undefined, label: string) {
  const byUuid = uuid ? (fields ?? []).filter((field) => field.uuid === uuid) : [];
  const matches = uuid ? byUuid : (fields ?? []).filter((field) => field.name === label);
  if (matches.length > 1) throw new Error(`${label}: KeyCRM передал поле повторно`);
  const field = matches[0];
  if (!field || field.value === null || field.value === undefined || field.value === "") return { value: null, exactNameFallback: false };
  if (field.type !== "date") throw new Error(`${label}: ожидается тип date`);
  if (typeof field.value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(field.value.trim())) throw new Error(`${label}: ожидается дата YYYY-MM-DD`);
  const parsed = new Date(`${field.value.trim()}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== field.value.trim()) throw new Error(`${label}: некорректная календарная дата`);
  return { value: parsed, exactNameFallback: !uuid };
}

function nonNegativeMoneyToMinor(value: unknown, label: string) {
  const minor = keycrmMoneyToMinor(value);
  if (minor < 0) throw new Error(`${label} не может быть отрицательной`);
  return minor;
}

export type NormalizedKeycrmOrder = ReturnType<typeof normalizeKeycrmOrder>;

export function normalizeKeycrmOrder(raw: KeycrmOrder, options: { connectionKey: string; defaultCurrency: string; sourceNames: Record<string, string>; sourceCurrencies?: Record<string, string>; defaultOrderType?: OrderType; productionStartFieldUuid?: string; expectedDeliveryFieldUuid?: string }) {
  if (!Number.isInteger(raw.id) || raw.id <= 0) throw new Error("У заказа KeyCRM отсутствует корректный ID");
  const sourceId = raw.source_id === null || raw.source_id === undefined ? null : String(raw.source_id);
  if (sourceId && !options.sourceCurrencies?.[sourceId]) throw new Error(`Для источника KeyCRM #${sourceId} не указана валюта`);
  const sourceCurrency = currencyCode(sourceId ? options.sourceCurrencies?.[sourceId] : options.defaultCurrency, "Валюта заказа KeyCRM");
  const paidCurrencies = new Set(
    (raw.payments ?? [])
      .filter((payment) => payment.status?.trim().toLowerCase() === "paid")
      .map((payment) => currencyCode(payment.actual_currency || sourceCurrency, `Валюта оплаты KeyCRM #${payment.id ?? "?"}`)),
  );
  if (paidCurrencies.size > 1) {
    throw new Error("KeyCRM передал несколько валют проведённых оплат для одного заказа");
  }
  const currency = paidCurrencies.values().next().value ?? sourceCurrency;
  const priceMinor = keycrmRequiredMoneyToMinor(raw.grand_total, "Полная стоимость заказа");
  const sourceName = options.sourceNames[String(raw.source_id)] ?? `KeyCRM source #${raw.source_id}`;
  const buyerName = raw.buyer?.full_name?.trim() || `Клиент KeyCRM #${raw.buyer?.id ?? raw.id}`;
  const deliveryService = raw.shipping?.deliveryService ?? raw.shipping?.delivery_service;
  const addressLine1 = raw.shipping?.shipping_receive_point?.trim() || null;
  const addressLine2 = raw.shipping?.shipping_secondary_line?.trim() || null;
  const addressParts = [addressLine1, addressLine2, raw.shipping?.shipping_address_city, raw.shipping?.shipping_address_region, raw.shipping?.shipping_address_zip, raw.shipping?.shipping_address_country].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));
  const orderedAt = keycrmDate(raw.ordered_at ?? raw.created_at);
  if (!orderedAt) throw new Error("KeyCRM не передал дату создания заказа");
  const productionStart = customFieldDate(raw.custom_fields, options.productionStartFieldUuid, "Початок виробництва");
  const expectedDelivery = customFieldDate(raw.custom_fields, options.expectedDeliveryFieldUuid, "Очікувана дата доставки");
  const productionStartsAt = productionStart.value;
  const shippingDate = keycrmDate(raw.shipping?.shipping_date ?? raw.shipping?.shipping_date_actual);
  const requiredDeliveryAt = expectedDelivery.value ?? shippingDate;
  return {
    sourceSystem: SOURCE_SYSTEM,
    sourceAccount: options.connectionKey,
    externalId: String(raw.id),
    number: `KC-${raw.id}`,
    externalNumber: raw.source_uuid === null || raw.source_uuid === undefined ? null : String(raw.source_uuid),
    externalUpdatedAt: keycrmDate(raw.updated_at),
    sourceName,
    type: options.defaultOrderType ?? OrderType.CUSTOM_ORDER,
    priceMinor,
    currency,
    depositRequiredMinor: Math.round(priceMinor / 2),
    deliveryMinor: keycrmMoneyToMinor(raw.shipping_price),
    discountMinor: keycrmMoneyToMinor(raw.total_discount),
    taxMinor: keycrmMoneyToMinor(raw.taxes),
    giftWrapMinor: keycrmMoneyToMinor(raw.wrap_price),
    paymentStatus: paymentStatus(raw.payment_status),
    salesStatus: salesStatus(raw.status),
    productionStatus: "NOT_SCHEDULED" as const,
    shippingStatus: shippingStatus(raw.shipping),
    buyerComment: raw.buyer_comment?.trim() || null,
    managerComment: raw.manager_comment?.trim() || null,
    giftMessage: raw.gift_message?.trim() || null,
    promocode: raw.promocode?.trim() || null,
    isGift: Boolean(raw.is_gift),
    orderedAt,
    requiredDeliveryAt,
    production: { startsAt: productionStartsAt, requiredDeliveryAt, exactNameFallbacks: [productionStart.exactNameFallback ? "Початок виробництва" : null, expectedDelivery.exactNameFallback ? "Очікувана дата доставки" : null].filter((value): value is string => Boolean(value)) },
    client: {
      keycrmBuyerId: raw.buyer?.id ?? null,
      displayName: buyerName,
      firstName: buyerName,
      email: normalizedEmail(raw.buyer?.email),
      phone: normalizedPhone(raw.buyer?.phone),
      source: keycrmSourceChannel(sourceName),
      country: raw.shipping?.shipping_address_country?.trim() || null,
      city: raw.shipping?.shipping_address_city?.trim() || null,
      address: addressLine1,
      postalCode: raw.shipping?.shipping_address_zip?.trim() || null,
      sourcePayload: raw.buyer ?? null,
    },
    delivery: {
      recipient: raw.shipping?.recipient_full_name?.trim() || buyerName,
      recipientPhone: raw.shipping?.recipient_phone?.trim() || null,
      addressLine1,
      addressLine2,
      city: raw.shipping?.shipping_address_city?.trim() || null,
      region: raw.shipping?.shipping_address_region?.trim() || null,
      postalCode: raw.shipping?.shipping_address_zip?.trim() || null,
      country: raw.shipping?.shipping_address_country?.trim() || null,
      addressText: addressParts.join(", ") || null,
      serviceId: raw.shipping?.delivery_service_id ? String(raw.shipping.delivery_service_id) : null,
      serviceName: deliveryService?.name?.trim() || null,
      trackingCode: raw.shipping?.tracking_code?.trim() || null,
      externalStatus: raw.shipping?.shipping_status?.trim() || null,
      shippedAt: keycrmDate(raw.shipping?.shipping_date_actual),
    },
    items: (raw.products ?? []).map((item, index) => ({
      sourceSystem: SOURCE_SYSTEM,
      sourceAccount: options.connectionKey,
      externalId: itemExternalId(raw.id, item, index),
      name: item.name?.trim() || item.sku?.trim() || `Товар KeyCRM ${index + 1}`,
      sku: item.sku?.trim() || item.offer?.sku?.trim() || null,
      quantity: itemQuantity(item.quantity),
      priceMinor: nonNegativeMoneyToMinor(item.price_sold ?? item.price, `Цена товара ${index + 1}`),
      notes: item.comment?.trim() || null,
      externalImageUrl: externalImageUrl(item.picture),
      properties: item.properties ?? [],
    })),
    payments: (raw.payments ?? []).filter((payment) => payment.id).flatMap((payment) => {
      const externalStatus = payment.status?.trim().toLowerCase() || "unknown";
      const isPaid = externalStatus === "paid";
      const receivedAt = keycrmDate(payment.payment_date ?? payment.created_at);
      if (isPaid && !receivedAt) throw new Error(`KeyCRM не передал дату оплаты #${payment.id}`);
      const paymentCurrency = currencyCode(payment.actual_currency || currency, `Валюта оплаты KeyCRM #${payment.id}`);
      if (isPaid && paymentCurrency !== currency) throw new Error(`Валюта оплаты KeyCRM #${payment.id} не совпадает с валютой заказа`);
      return [{
        sourceSystem: SOURCE_SYSTEM,
        sourceAccount: options.connectionKey,
        externalId: String(payment.id),
        externalStatus,
        isPaid,
        materializeIfMissing: isPaid || paymentCurrency === currency,
        amountMinor: isPaid
          ? keycrmRequiredMoneyToMinor(payment.amount, `Оплата KeyCRM #${payment.id}`, false)
          : keycrmRequiredMoneyToMinor(payment.amount, `Оплата KeyCRM #${payment.id}`),
        currency: paymentCurrency,
        method: "OTHER" as const,
        receivedAt,
        reference: payment.transaction_uuid?.trim() || null,
        notes: [payment.description?.trim(), payment.payment_method_id ? `KeyCRM method #${payment.payment_method_id}` : null].filter(Boolean).join(" · ") || null,
      }];
    }),
    customFields: raw.custom_fields ?? [],
    externalData: raw,
  };
}
