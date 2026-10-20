import { BadRequestException } from "@nestjs/common";
import { buildPaymentConversion, buildRateForPair, convertMinorWithRate, parseDecimalRational, EXCHANGE_RATE_CURRENCIES, type ExchangeRateCurrency, type PaymentConversionSnapshot } from "../finance/exchange-rates";

type Charge = {
  customerChargeMinor: number;
  currency: string;
  customerChargeOriginalMinor?: number | null;
  customerChargeOriginalCurrency?: string | null;
  customerChargeRateSnapshot?: unknown;
};

function assertSavedSnapshot(saved: PaymentConversionSnapshot) {
  const officialUrls = { NBU: "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew", ECB: "https://data.ecb.europa.eu/help/api/data" };
  if (saved.officialUrl !== officialUrls[saved.provider] || !/^\d{4}-\d{2}-\d{2}$/.test(saved.effectiveDate ?? "") ||
      new Date(`${saved.effectiveDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== saved.effectiveDate ||
      typeof saved.fetchedAt !== "string" || !Number.isFinite(Date.parse(saved.fetchedAt)) ||
      !Array.isArray(saved.sourceRates) || !Array.isArray(saved.sourceObservations) ||
      !saved.sourceObservations.length || saved.sourceObservations.length > 2) throw new Error("Incomplete conversion evidence");
  const pairs = new Set<string>();
  for (const observation of saved.sourceObservations) {
    const pair = `${observation.baseCurrency}/${observation.quoteCurrency}`;
    const allowed = saved.provider === "ECB" ? ["EUR/USD"] : ["EUR/UAH", "USD/UAH"];
    if (!allowed.includes(pair) || pairs.has(pair) || typeof observation.decimal !== "string" ||
        observation.sourceSeriesOrValcode !== (saved.provider === "ECB" ? "EXR/D.USD.EUR.SP00.A" : observation.baseCurrency)) throw new Error("Invalid conversion observation");
    pairs.add(pair);
    const parsed = parseDecimalRational(observation.decimal);
    if (parsed.numerator !== observation.numerator || parsed.denominator !== observation.denominator) throw new Error("Inconsistent conversion observation");
  }
  // Rebuild only from the immutable observations; never apply today's freshness policy.
  const rate = buildRateForPair({ version: 1, provider: saved.provider, officialUrl: saved.officialUrl,
    effectiveDate: saved.effectiveDate, fetchedAt: saved.fetchedAt, rates: saved.sourceObservations }, saved.from, saved.to);
  if (rate.numerator !== saved.rate.numerator || rate.denominator !== saved.rate.denominator ||
      JSON.stringify(rate.sourceRates) !== JSON.stringify(saved.sourceRates)) throw new Error("Inconsistent conversion evidence");
}

export function assertShippingMoney(amount: number, currency: string) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 2_147_483_647 || !EXCHANGE_RATE_CURRENCIES.includes(currency as ExchangeRateCurrency)) {
    throw new BadRequestException("Некорректная сумма или валюта доставки");
  }
}

export function hasOriginalShippingCharge(current: Charge) {
  return (current.customerChargeOriginalMinor ?? 0) > 0;
}

export function unchangedShippingCharge(current: Charge | null, amount: number, currency: string | undefined, orderCurrency: string) {
  assertShippingMoney(amount, currency ?? orderCurrency);
  if (!current) return false;
  assertShippingMoney(current.customerChargeMinor, current.currency);
  const original = current.customerChargeOriginalMinor, originalCurrency = current.customerChargeOriginalCurrency, snapshot = current.customerChargeRateSnapshot;
  const empty = original == null && originalCurrency == null && snapshot == null;
  if (!empty) {
    if (original == null || originalCurrency == null || !snapshot || typeof snapshot !== "object") throw new BadRequestException("Повреждена история конвертации доставки");
    assertShippingMoney(original, originalCurrency);
    const saved = snapshot as PaymentConversionSnapshot;
    try {
      if (original <= 0 || originalCurrency === current.currency || saved.from !== originalCurrency || saved.to !== current.currency || !["NBU", "ECB"].includes(saved.provider) || !saved.rate || convertMinorWithRate(original, saved.rate) !== current.customerChargeMinor) throw new Error();
      assertSavedSnapshot(saved);
    } catch { throw new BadRequestException("Повреждена история конвертации доставки"); }
  }
  return current.currency === orderCurrency && (currency === undefined
    ? current.customerChargeMinor === amount
    : (original ?? current.customerChargeMinor) === amount && (originalCurrency ?? current.currency) === currency);
}

export function preservedShippingCharge(current: Charge) {
  return {
    customerChargeMinor: current.customerChargeMinor,
    customerChargeOriginalMinor: current.customerChargeOriginalMinor ?? null,
    customerChargeOriginalCurrency: current.customerChargeOriginalCurrency ?? null,
    customerChargeRateSnapshot: current.customerChargeRateSnapshot ?? null,
  };
}

// All NULL is the legacy/order-currency representation, also used for zero.
export function baseShippingCharge(amount: number) {
  return { customerChargeMinor: amount, customerChargeOriginalMinor: null, customerChargeOriginalCurrency: null, customerChargeRateSnapshot: null };
}

export function convertedShippingCharge(cache: Parameters<typeof buildPaymentConversion>[0], amount: number, from: string, to: string) {
  try {
    const conversion = buildPaymentConversion(cache, amount, from as ExchangeRateCurrency, to as ExchangeRateCurrency);
    return { customerChargeMinor: conversion.appliedAmountMinor, customerChargeOriginalMinor: amount, customerChargeOriginalCurrency: from, customerChargeRateSnapshot: conversion.snapshot };
  } catch (error) {
    throw new BadRequestException(error instanceof Error ? `Не удалось пересчитать доставку: ${error.message}` : "Не удалось пересчитать доставку");
  }
}
