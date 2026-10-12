import { ConflictException, Injectable, ServiceUnavailableException } from "@nestjs/common";
import type { Prisma, User } from "@prisma/client";
import { PrismaService } from "../prisma.service";

export const EXCHANGE_RATE_PROVIDERS = ["ECB", "NBU"] as const;
export const EXCHANGE_RATE_CURRENCIES = ["EUR", "USD", "UAH"] as const;
export const EXCHANGE_RATE_ADVISORY_LOCK = "yoleotard-exchange-rates";
export type ExchangeRateProvider = typeof EXCHANGE_RATE_PROVIDERS[number];
export type ExchangeRateCurrency = typeof EXCHANGE_RATE_CURRENCIES[number];
export type RationalRate = { numerator: string; denominator: string };
export type ExchangeRateObservation = RationalRate & {
  baseCurrency: ExchangeRateCurrency;
  quoteCurrency: ExchangeRateCurrency;
  decimal: string;
  sourceSeriesOrValcode: string;
};
export type ExchangeRateCache = {
  version: 1;
  provider: ExchangeRateProvider;
  officialUrl: string;
  effectiveDate: string;
  fetchedAt: string;
  rates: ExchangeRateObservation[];
};
export type PaymentConversionSnapshot = {
  from: ExchangeRateCurrency;
  to: ExchangeRateCurrency;
  provider: ExchangeRateProvider;
  officialUrl: string;
  effectiveDate: string;
  fetchedAt: string;
  rate: RationalRate;
  sourceRates: string[];
  sourceObservations: ExchangeRateObservation[];
};

const PROVIDER_INFO = {
  ECB: {
    officialUrl: "https://data.ecb.europa.eu/help/api/data",
    supportedPairs: ["EUR/USD", "USD/EUR"],
  },
  NBU: {
    officialUrl: "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew",
    supportedPairs: ["EUR/USD", "USD/EUR", "EUR/UAH", "UAH/EUR", "USD/UAH", "UAH/USD"],
  },
} as const;
const ECB_URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A?format=csvdata&lastNObservations=1";
const NBU_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew?json&valcode=";
const FETCH_TIMEOUT_MS = 8_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const PRISMA_INT_MAX = 2_147_483_647n;
export const MAX_EFFECTIVE_DATE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const CALENDAR_DAY_MS = 24 * 60 * 60 * 1000;
const BUSINESS_TIME_ZONE = "Europe/Kyiv";

function businessCalendarDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: BUSINESS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: "year" | "month" | "day") => parts.find(part => part.type === type)?.value;
  const year = value("year"), month = value("month"), day = value("day");
  if (!year || !month || !day) throw new Error("Не удалось определить календарную дату курса");
  return `${year}-${month}-${day}`;
}

export function assertEffectiveDateFresh(effectiveDate: string, now: Date, maxFutureCalendarDays = 0) {
  const effectiveAt = Date.parse(`${effectiveDate}T00:00:00.000Z`);
  const currentCalendarAt = Date.parse(`${businessCalendarDate(now)}T00:00:00.000Z`);
  if (!Number.isFinite(effectiveAt) || effectiveAt > currentCalendarAt + maxFutureCalendarDays * CALENDAR_DAY_MS) throw new Error("Дата официального курса находится в будущем");
  if (currentCalendarAt - effectiveAt > MAX_EFFECTIVE_DATE_AGE_MS) throw new Error("Дата официального курса устарела");
}

export function assertExchangeRateCacheFresh(cache: ExchangeRateCache, now = new Date()) {
  assertEffectiveDateFresh(cache.effectiveDate, now, cache.provider === "NBU" ? 1 : 0);
  const fetchedAt = Date.parse(cache.fetchedAt);
  if (!Number.isFinite(fetchedAt) || fetchedAt > now.getTime() + 60_000 || now.getTime() - fetchedAt > MAX_EFFECTIVE_DATE_AGE_MS) throw new Error("Кэш официальных курсов устарел");
}

function gcd(left: bigint, right: bigint) {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b) [a, b] = [b, a % b];
  return a;
}

function normalizeRational(numerator: bigint, denominator: bigint): RationalRate {
  if (numerator <= 0n || denominator <= 0n) throw new Error("Курс должен быть положительным");
  const divisor = gcd(numerator, denominator);
  return { numerator: String(numerator / divisor), denominator: String(denominator / divisor) };
}

export function parseDecimalRational(value: string): RationalRate {
  const normalized = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,12})?$/.test(normalized)) throw new Error("Недопустимый формат курса");
  const [whole, fraction = ""] = normalized.split(".");
  const denominator = 10n ** BigInt(fraction.length);
  const numerator = BigInt(whole!) * denominator + BigInt(fraction || "0");
  return normalizeRational(numerator, denominator);
}

export function convertMinorWithRate(amountMinor: number, rate: RationalRate) {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new Error("Сумма вне допустимого диапазона");
  const numerator = BigInt(rate.numerator), denominator = BigInt(rate.denominator);
  if (numerator <= 0n || denominator <= 0n) throw new Error("Курс должен быть положительным");
  const converted = (BigInt(amountMinor) * numerator * 2n + denominator) / (denominator * 2n);
  if (converted > PRISMA_INT_MAX) throw new Error("Результат конвертации вне допустимого диапазона");
  return Number(converted);
}

function csvRow(line: string) {
  const fields: string[] = [];
  let value = "", quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) { fields.push(value); value = ""; }
    else value += character;
  }
  if (quoted) throw new Error("Некорректный CSV ECB");
  fields.push(value);
  return fields;
}

export function parseEcbCsv(payload: string) {
  const lines = payload.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length !== 2) throw new Error("ECB должен вернуть одно наблюдение");
  const headers = csvRow(lines[0]!), values = csvRow(lines[1]!);
  const field = (name: string) => values[headers.indexOf(name)]?.trim();
  if (field("CURRENCY") !== "USD" || field("CURRENCY_DENOM") !== "EUR") throw new Error("ECB вернул неожиданную пару валют");
  if (field("OBS_STATUS") !== "A") throw new Error("ECB вернул неподтверждённый статус наблюдения");
  const effectiveDate = field("TIME_PERIOD"), decimal = field("OBS_VALUE");
  if (!effectiveDate || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) || !decimal) throw new Error("ECB вернул неполное наблюдение");
  return { effectiveDate, decimal, ...parseDecimalRational(decimal) };
}

export function parseNbuResponse(payload: unknown, currency: "EUR" | "USD") {
  if (!Array.isArray(payload) || payload.length !== 1 || !payload[0] || typeof payload[0] !== "object") throw new Error("НБУ должен вернуть одну запись курса");
  const row = payload[0] as Record<string, unknown>;
  if (row.cc !== currency) throw new Error("НБУ вернул неожиданный код валюты");
  const decimal = typeof row.rate === "number" || typeof row.rate === "string" ? String(row.rate) : "";
  const match = typeof row.exchangedate === "string" ? /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(row.exchangedate) : null;
  if (!match) throw new Error("НБУ вернул некорректную дату курса");
  const effectiveDate = `${match[3]}-${match[2]}-${match[1]}`;
  if (new Date(`${effectiveDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== effectiveDate) throw new Error("НБУ вернул несуществующую дату курса");
  return { effectiveDate, decimal, ...parseDecimalRational(decimal) };
}

function cacheObservation(cache: ExchangeRateCache, base: ExchangeRateCurrency, quote: ExchangeRateCurrency) {
  return cache.rates.find(rate => rate.baseCurrency === base && rate.quoteCurrency === quote);
}

export function buildRateForPair(cache: ExchangeRateCache, from: ExchangeRateCurrency, to: ExchangeRateCurrency): RationalRate & { sourceRates: string[] } {
  if (from === to) return { numerator: "1", denominator: "1", sourceRates: [] };
  const direct = cacheObservation(cache, from, to);
  if (direct) return { numerator: direct.numerator, denominator: direct.denominator, sourceRates: [`${from}/${to}`] };
  const inverse = cacheObservation(cache, to, from);
  if (inverse) return { numerator: inverse.denominator, denominator: inverse.numerator, sourceRates: [`${to}/${from}`] };
  if (cache.provider === "NBU") {
    const fromUah = from === "UAH" ? { numerator: "1", denominator: "1" } : cacheObservation(cache, from, "UAH");
    const toUah = to === "UAH" ? { numerator: "1", denominator: "1" } : cacheObservation(cache, to, "UAH");
    if (fromUah && toUah) {
      const rate = normalizeRational(BigInt(fromUah.numerator) * BigInt(toUah.denominator), BigInt(fromUah.denominator) * BigInt(toUah.numerator));
      return { ...rate, sourceRates: [`${from}/UAH`, `${to}/UAH`].filter(pair => !pair.startsWith("UAH/")) };
    }
  }
  throw new Error(`Источник ${cache.provider} не поддерживает конвертацию ${from}/${to}`);
}

export function buildPaymentConversion(cache: ExchangeRateCache, amountMinor: number, from: ExchangeRateCurrency, to: ExchangeRateCurrency, now = new Date()) {
  assertExchangeRateCacheFresh(cache, now);
  const rate = buildRateForPair(cache, from, to);
  const sourceObservations = rate.sourceRates.map(pair => {
    const [baseCurrency, quoteCurrency] = pair.split("/");
    const observation = cache.rates.find(candidate => candidate.baseCurrency === baseCurrency && candidate.quoteCurrency === quoteCurrency);
    if (!observation) throw new Error("Кэш официальных курсов не содержит исходное наблюдение");
    return { ...observation };
  });
  const snapshot: PaymentConversionSnapshot = {
    from, to, provider: cache.provider, officialUrl: cache.officialUrl, effectiveDate: cache.effectiveDate, fetchedAt: cache.fetchedAt,
    rate: { numerator: rate.numerator, denominator: rate.denominator }, sourceRates: rate.sourceRates, sourceObservations,
  };
  return { appliedAmountMinor: convertMinorWithRate(amountMinor, rate), appliedCurrency: to, snapshot };
}

export function appliedPaymentMinor(payment: { amountMinor: number; currency: string; appliedAmountMinor?: number | null; appliedCurrency?: string | null }, orderCurrency: string) {
  if (payment.currency === orderCurrency) return payment.amountMinor;
  return payment.appliedCurrency === orderCurrency && Number.isSafeInteger(payment.appliedAmountMinor) && (payment.appliedAmountMinor ?? -1) >= 0 ? payment.appliedAmountMinor! : 0;
}

function isProvider(value: unknown): value is ExchangeRateProvider { return value === "ECB" || value === "NBU"; }

export function parseExchangeRateCache(value: unknown): ExchangeRateCache {
  if (!value || typeof value !== "object") throw new Error("Кэш курсов отсутствует");
  const cache = value as Partial<ExchangeRateCache>;
  if (cache.version !== 1 || !isProvider(cache.provider) || cache.officialUrl !== PROVIDER_INFO[cache.provider].officialUrl || !/^\d{4}-\d{2}-\d{2}$/.test(cache.effectiveDate ?? "") || !cache.fetchedAt || !Number.isFinite(Date.parse(cache.fetchedAt)) || !Array.isArray(cache.rates) || !cache.rates.length) throw new Error("Кэш курсов повреждён");
  if (new Date(`${cache.effectiveDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== cache.effectiveDate) throw new Error("Кэш курсов содержит некорректную дату");
  for (const rate of cache.rates) {
    if (!EXCHANGE_RATE_CURRENCIES.includes(rate.baseCurrency) || !EXCHANGE_RATE_CURRENCIES.includes(rate.quoteCurrency) || typeof rate.decimal !== "string" || typeof rate.sourceSeriesOrValcode !== "string") throw new Error("Кэш курсов повреждён");
    const parsed = parseDecimalRational(rate.decimal);
    if (parsed.numerator !== rate.numerator || parsed.denominator !== rate.denominator) throw new Error("Кэш курсов не прошёл проверку точности");
  }
  const expectedPairs = cache.provider === "ECB" ? ["EUR/USD"] : ["EUR/UAH", "USD/UAH"];
  const actualPairs = cache.rates.map(rate => `${rate.baseCurrency}/${rate.quoteCurrency}`).sort();
  if (actualPairs.join(",") !== expectedPairs.sort().join(",")) throw new Error("Кэш курсов содержит неожиданный набор валют");
  if (cache.provider === "ECB" && cache.rates[0]?.sourceSeriesOrValcode !== "EXR/D.USD.EUR.SP00.A") throw new Error("Кэш ECB содержит неожиданный идентификатор ряда");
  if (cache.provider === "NBU" && cache.rates.some(rate => rate.sourceSeriesOrValcode !== rate.baseCurrency)) throw new Error("Кэш НБУ содержит неожиданный код валюты");
  return cache as ExchangeRateCache;
}

async function fetchText(url: string, fetcher: typeof fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetcher(url, { headers: { Accept: "text/csv, application/json" }, signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    if (!text || Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) throw new Error("Недопустимый размер ответа");
    return text;
  } finally { clearTimeout(timer); }
}

export async function fetchOfficialRates(provider: ExchangeRateProvider, fetcher: typeof fetch = fetch, now = new Date()): Promise<ExchangeRateCache> {
  if (provider === "ECB") {
    const observation = parseEcbCsv(await fetchText(ECB_URL, fetcher));
    assertEffectiveDateFresh(observation.effectiveDate, now);
    return { version: 1, provider, officialUrl: PROVIDER_INFO.ECB.officialUrl, effectiveDate: observation.effectiveDate, fetchedAt: now.toISOString(), rates: [{ baseCurrency: "EUR", quoteCurrency: "USD", decimal: observation.decimal, numerator: observation.numerator, denominator: observation.denominator, sourceSeriesOrValcode: "EXR/D.USD.EUR.SP00.A" }] };
  }
  const [eurText, usdText] = await Promise.all([fetchText(`${NBU_URL}EUR`, fetcher), fetchText(`${NBU_URL}USD`, fetcher)]);
  let eurPayload: unknown, usdPayload: unknown;
  try { eurPayload = JSON.parse(eurText); usdPayload = JSON.parse(usdText); } catch { throw new Error("НБУ вернул некорректный JSON"); }
  const eur = parseNbuResponse(eurPayload, "EUR"), usd = parseNbuResponse(usdPayload, "USD");
  if (eur.effectiveDate !== usd.effectiveDate) throw new Error("НБУ вернул курсы на разные даты");
  // NBU may publish tomorrow's official rate during the preceding calendar day.
  assertEffectiveDateFresh(eur.effectiveDate, now, 1);
  return { version: 1, provider, officialUrl: PROVIDER_INFO.NBU.officialUrl, effectiveDate: eur.effectiveDate, fetchedAt: now.toISOString(), rates: [
    { baseCurrency: "EUR", quoteCurrency: "UAH", decimal: eur.decimal, numerator: eur.numerator, denominator: eur.denominator, sourceSeriesOrValcode: "EUR" },
    { baseCurrency: "USD", quoteCurrency: "UAH", decimal: usd.decimal, numerator: usd.numerator, denominator: usd.denominator, sourceSeriesOrValcode: "USD" },
  ] };
}

@Injectable()
export class ExchangeRatesService {
  constructor(private readonly prisma: PrismaService) {}

  async status() {
    const [providerSetting, cacheSetting] = await Promise.all([
      this.prisma.appSetting.findUnique({ where: { section_key: { section: "finance", key: "exchangeRateProvider" } } }),
      this.prisma.appSetting.findUnique({ where: { section_key: { section: "finance", key: "exchangeRateCache" } } }),
    ]);
    const provider = isProvider(providerSetting?.value) ? providerSetting.value : "NBU";
    let cache: ExchangeRateCache | null = null;
    try { if (cacheSetting?.value) cache = parseExchangeRateCache(cacheSetting.value); } catch { cache = null; }
    return { provider, ...PROVIDER_INFO[provider], cache: cache?.provider === provider ? cache : null };
  }

  async setProvider(provider: ExchangeRateProvider, actor: User) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", EXCHANGE_RATE_ADVISORY_LOCK);
      const before = await tx.appSetting.findUnique({ where: { section_key: { section: "finance", key: "exchangeRateProvider" } } });
      const setting = await tx.appSetting.upsert({ where: { section_key: { section: "finance", key: "exchangeRateProvider" } }, create: { section: "finance", key: "exchangeRateProvider", value: provider }, update: { value: provider } });
      await tx.appSetting.deleteMany({ where: { section: "finance", key: "exchangeRateCache" } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "AppSetting", entityId: setting.id, before: before as Prisma.InputJsonValue | undefined, after: { ...setting, exchangeRateCacheInvalidated: true } } });
      return { provider, ...PROVIDER_INFO[provider], cache: null };
    });
  }

  async currentOrRefresh(actor: User, fetcher: typeof fetch = fetch, now = new Date()) {
    const current = await this.status();
    try {
      if (!current.cache) throw new Error("Кэш курсов отсутствует");
      assertExchangeRateCacheFresh(current.cache, now);
      return current.cache;
    } catch {
      const refreshed = await this.refresh(actor, fetcher, now);
      if (!refreshed.cache) throw new ServiceUnavailableException("Официальные курсы недоступны");
      return refreshed.cache;
    }
  }

  async refresh(actor: User, fetcher: typeof fetch = fetch, now = new Date()) {
    const providerSetting = await this.prisma.appSetting.findUnique({ where: { section_key: { section: "finance", key: "exchangeRateProvider" } } });
    const provider = isProvider(providerSetting?.value) ? providerSetting.value : "NBU";
    let cache: ExchangeRateCache;
    try { cache = await fetchOfficialRates(provider, fetcher, now); } catch (error) { throw new ServiceUnavailableException(`Не удалось получить официальный курс ${provider}: ${error instanceof Error ? error.message : "неизвестная ошибка"}`); }
    return this.prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))", EXCHANGE_RATE_ADVISORY_LOCK);
      const currentProvider = await tx.appSetting.findUnique({ where: { section_key: { section: "finance", key: "exchangeRateProvider" } } });
      const effectiveProvider = isProvider(currentProvider?.value) ? currentProvider.value : "NBU";
      if (effectiveProvider !== provider) throw new ConflictException("Источник курсов изменился во время обновления. Повторите запрос");
      const before = await tx.appSetting.findUnique({ where: { section_key: { section: "finance", key: "exchangeRateCache" } } });
      const setting = await tx.appSetting.upsert({ where: { section_key: { section: "finance", key: "exchangeRateCache" } }, create: { section: "finance", key: "exchangeRateCache", value: cache as unknown as Prisma.InputJsonValue }, update: { value: cache as unknown as Prisma.InputJsonValue } });
      await tx.auditLog.create({ data: { actorId: actor.id, action: "UPDATE", entityType: "AppSetting", entityId: setting.id, before: before as Prisma.InputJsonValue | undefined, after: setting } });
      return { provider, ...PROVIDER_INFO[provider], cache };
    });
  }
}
