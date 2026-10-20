import { assertExchangeRateCacheFresh, buildRateForPair, convertMinorWithRate, EXCHANGE_RATE_ADVISORY_LOCK, parseExchangeRateCache, type ExchangeRateCurrency } from "../finance/exchange-rates";
import type { Prisma } from "@prisma/client";

const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MONEY_FIELDS = ["priceMinor", "depositRequiredMinor", "deliveryMinor", "discountMinor", "taxMinor", "giftWrapMinor", "productionCostMinor"] as const;

export class OrderCurrencyChangeError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "OrderCurrencyChangeError"; }
}

type CurrencyTransaction = Prisma.TransactionClient;
export type OrderCurrencyExpectedState = {
  currency: string;
  type: string;
  description: string | null;
  priceMinor: number;
  requiredDeliveryAt: string | null;
  modelImagePath: string | null;
};

function provider(value: unknown) { return value === "ECB" || value === "NBU" ? value : "NBU"; }

export async function changeOrderCurrencyTransaction(tx: CurrencyTransaction, orderId: string, targetCurrency: ExchangeRateCurrency, actorId: string, now = new Date(), expected?: OrderCurrencyExpectedState) {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", EXCHANGE_RATE_ADVISORY_LOCK);
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", orderId);
  const order = await tx.order.findFirst({ where: { id: orderId, archivedAt: null }, include: { payments: true, invoices: true, expenses: true, shipment: true, items: true, orderShipments: { where: { archivedAt: null } } } });
  if (!order) throw new OrderCurrencyChangeError("ORDER_NOT_FOUND", "Заказ не найден");
  if (expected && (order.currency !== expected.currency || order.type !== expected.type || (order.notes ?? null) !== expected.description || order.priceMinor !== expected.priceMinor || (order.requiredDeliveryAt?.toISOString() ?? null) !== expected.requiredDeliveryAt || (order.modelImagePath ?? null) !== expected.modelImagePath)) {
    throw new OrderCurrencyChangeError("ORDER_CHANGED", "Заказ уже изменён другим пользователем");
  }
  if (order.currency === targetCurrency) return { order, conversion: null };
  if (!(["EUR", "USD", "UAH"] as string[]).includes(order.currency)) throw new OrderCurrencyChangeError("ORDER_CURRENCY_UNSUPPORTED", `Текущая валюта заказа ${order.currency} не поддерживается`);
  if (order.payments.length) throw new OrderCurrencyChangeError("PAYMENT_HISTORY_EXISTS", "Нельзя изменить валюту заказа с историей оплат");
  if (order.invoices.length) throw new OrderCurrencyChangeError("INVOICE_HISTORY_EXISTS", "Нельзя изменить валюту заказа с историей инвойсов");
  if (order.expenses.length) throw new OrderCurrencyChangeError("EXPENSE_HISTORY_EXISTS", "Нельзя изменить валюту заказа со связанными расходами");
  if (order.shipment?.costMinor) throw new OrderCurrencyChangeError("SHIPMENT_COST_EXISTS", "Нельзя изменить валюту заказа с расходами на доставку");
  if ((order.orderShipments ?? []).some((shipment) => shipment.customerChargeMinor > 0 || (shipment.customerChargeOriginalMinor ?? 0) > 0 || shipment.atelierCostMinor > 0)) throw new OrderCurrencyChangeError("SHIPMENT_COST_EXISTS", "Нельзя изменить валюту заказа с доходами или расходами по посылкам");
  if (String(order.sourceSystem ?? "").toUpperCase() === "KEYCRM") throw new OrderCurrencyChangeError("KEYCRM_ORDER_OWNED", "Валюта заказа, управляемого KeyCRM, изменяется только в источнике");
  const [providerSetting, cacheSetting] = await Promise.all([
    tx.appSetting.findUnique({ where: { section_key: { section: "finance", key: "exchangeRateProvider" } } }),
    tx.appSetting.findUnique({ where: { section_key: { section: "finance", key: "exchangeRateCache" } } }),
  ]);
  let cache;
  try { cache = parseExchangeRateCache(cacheSetting?.value); } catch { throw new OrderCurrencyChangeError("RATE_CACHE_INVALID", "Официальные курсы недоступны; обновите курсы в настройках"); }
  const selectedProvider = provider(providerSetting?.value);
  try {
    assertExchangeRateCacheFresh(cache, now);
  } catch {
    throw new OrderCurrencyChangeError("RATE_CACHE_STALE", "Официальные курсы устарели; обновите курсы в настройках");
  }
  if (cache.provider !== selectedProvider || now.getTime() - Date.parse(cache.fetchedAt) > MAX_CACHE_AGE_MS || Date.parse(cache.fetchedAt) > now.getTime() + 60_000) throw new OrderCurrencyChangeError("RATE_CACHE_STALE", "Официальные курсы устарели; обновите курсы в настройках");
  let rate;
  try { rate = buildRateForPair(cache, order.currency as ExchangeRateCurrency, targetCurrency); } catch (error) { throw new OrderCurrencyChangeError("PAIR_NOT_SUPPORTED", error instanceof Error ? error.message : "Валютная пара не поддерживается"); }
  const converted: Record<string, number | null> = {};
  let convertedItems: { id: string; priceMinor: number }[];
  try {
    for (const field of MONEY_FIELDS) converted[field] = order[field] === null ? null : convertMinorWithRate(order[field], rate);
    convertedItems = order.items.map((item: { id: string; priceMinor: number }) => ({ id: item.id, priceMinor: convertMinorWithRate(item.priceMinor, rate) }));
  } catch {
    throw new OrderCurrencyChangeError("AMOUNT_OUT_OF_RANGE", "После пересчёта сумма выходит за допустимый диапазон");
  }
  for (const item of convertedItems) await tx.orderItem.update({ where: { id: item.id }, data: { priceMinor: item.priceMinor } });
  const updated = await tx.order.update({ where: { id: orderId }, data: { currency: targetCurrency, ...converted } });
  const sourceObservations = rate.sourceRates.map(pair => {
    const [baseCurrency, quoteCurrency] = pair.split("/");
    const observation = cache.rates.find(candidate => candidate.baseCurrency === baseCurrency && candidate.quoteCurrency === quoteCurrency);
    if (!observation) throw new OrderCurrencyChangeError("RATE_CACHE_INVALID", "Кэш официальных курсов не содержит исходное наблюдение");
    return { ...observation };
  });
  const conversion = { from: order.currency, to: targetCurrency, provider: cache.provider, officialUrl: cache.officialUrl, effectiveDate: cache.effectiveDate, fetchedAt: cache.fetchedAt, rate: { numerator: rate.numerator, denominator: rate.denominator }, sourceRates: rate.sourceRates, sourceObservations };
  await tx.activity.create({ data: { clientId: order.clientId, orderId, type: "ORDER_CURRENCY_CHANGED", summary: `Валюта заказа изменена с ${order.currency} на ${targetCurrency}`, metadata: conversion } });
  await tx.auditLog.create({ data: { actorId, action: "UPDATE", entityType: "Order", entityId: orderId, before: { currency: order.currency, amounts: Object.fromEntries(MONEY_FIELDS.map(field => [field, order[field]])), items: order.items.map((item: { id: string; priceMinor: number }) => ({ id: item.id, priceMinor: item.priceMinor })) }, after: { currency: targetCurrency, amounts: converted, items: convertedItems, conversion } } });
  const itemPrice = new Map(convertedItems.map((item: { id: string; priceMinor: number }) => [item.id, item.priceMinor]));
  return { order: { ...updated, items: order.items.map((item: { id: string; priceMinor: number }) => ({ ...item, priceMinor: itemPrice.get(item.id)! })) }, conversion };
}
