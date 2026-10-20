import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/finance/exchange-rates.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, experimentalDecorators: true, target: ts.ScriptTarget.ES2022 } }).outputText;
const exchangeModule = { exports: {} };
const nest = class extends Error {};
const localRequire = specifier => specifier === "@nestjs/common" ? { BadRequestException: nest, ConflictException: nest, Injectable: () => target => target, ServiceUnavailableException: nest } : specifier === "../prisma.service" ? { PrismaService: class {} } : {};
vm.runInNewContext(javascript, { module: exchangeModule, exports: exchangeModule.exports, require: localRequire, Buffer, AbortController, fetch, setTimeout, clearTimeout, console });
const { appliedPaymentMinor, buildPaymentConversion, buildRateForPair, convertMinorWithRate, ExchangeRatesService, fetchOfficialRates, parseDecimalRational, parseEcbCsv, parseNbuResponse } = exchangeModule.exports;
export const exchangeExports = exchangeModule.exports;
const plain = value => JSON.parse(JSON.stringify(value));

test("decimal rate is parsed as an exact rational without floating point", () => {
  assert.deepEqual(plain(parseDecimalRational("48.196")), { numerator: "12049", denominator: "250" });
  assert.throws(() => parseDecimalRational("0"), /положительным/);
  assert.throws(() => parseDecimalRational("1e3"), /формат/);
});

test("minor units use exact rational and round half-up", () => {
  assert.equal(convertMinorWithRate(1, { numerator: "1", denominator: "2" }), 1);
  assert.equal(convertMinorWithRate(20000, { numerator: "11715", denominator: "10000" }), 23430);
  assert.equal(convertMinorWithRate(2_147_483_647, { numerator: "1", denominator: "1" }), 2_147_483_647);
  assert.throws(() => convertMinorWithRate(1_073_741_824, { numerator: "2", denominator: "1" }), /диапазон/);
  assert.throws(() => convertMinorWithRate(Number.MAX_SAFE_INTEGER, { numerator: "2", denominator: "1" }), /диапазон/);
});

test("payment conversion preserves the received amount and applies its official order-currency equivalent", () => {
  const cache = {
    version: 1, provider: "NBU", officialUrl: "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew", effectiveDate: "2026-10-12", fetchedAt: "2026-10-11T15:35:00.000Z",
    rates: [
      { baseCurrency: "EUR", quoteCurrency: "UAH", decimal: "50.3138", numerator: "251569", denominator: "5000", sourceSeriesOrValcode: "EUR" },
      { baseCurrency: "USD", quoteCurrency: "UAH", decimal: "44.8894", numerator: "224447", denominator: "5000", sourceSeriesOrValcode: "USD" },
    ],
  };
  const conversion = plain(buildPaymentConversion(cache, 10000, "USD", "EUR", new Date("2026-10-11T15:40:00.000Z")));
  assert.equal(conversion.appliedAmountMinor, 8922);
  assert.equal(conversion.appliedCurrency, "EUR");
  assert.equal(conversion.snapshot.provider, "NBU");
  assert.equal(conversion.snapshot.effectiveDate, "2026-10-12");
  assert.equal(appliedPaymentMinor({ amountMinor: 10000, currency: "USD", ...conversion }, "EUR"), 8922);
  assert.equal(appliedPaymentMinor({ amountMinor: 5000, currency: "EUR" }, "EUR"), 5000);
  assert.equal(appliedPaymentMinor({ amountMinor: 5000, currency: "USD" }, "EUR"), 0);
});

test("ECB parser accepts only the expected EUR/USD observation", () => {
  const csv = "KEY,FREQ,CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE,OBS_STATUS\nEXR.D.USD.EUR.SP00.A,D,USD,EUR,2026-10-09,1.1587,A\n";
  assert.deepEqual(plain(parseEcbCsv(csv)), { effectiveDate: "2026-10-09", decimal: "1.1587", numerator: "11587", denominator: "10000" });
  assert.throws(() => parseEcbCsv(csv.replace(",USD,EUR,", ",UAH,EUR,")), /валют/);
  assert.throws(() => parseEcbCsv(csv.replace(",A\n", ",E\n")), /статус/);
});

test("NBU parser validates one official record and effective date", () => {
  assert.deepEqual(plain(parseNbuResponse([{ r030: 978, txt: "Євро", rate: 48.196, cc: "EUR", exchangedate: "01.09.2025" }], "EUR")), {
    effectiveDate: "2025-09-01", decimal: "48.196", numerator: "12049", denominator: "250",
  });
  assert.throws(() => parseNbuResponse([], "EUR"), /одну запись/);
  assert.throws(() => parseNbuResponse([{ rate: 41, cc: "USD", exchangedate: "01.09.2025" }], "EUR"), /код валюты/);
});

test("NBU cross-rate supports all EUR USD UAH pairs while ECB rejects UAH", () => {
  const nbu = {
    version: 1, provider: "NBU", officialUrl: "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew", effectiveDate: "2025-09-01", fetchedAt: "2025-09-01T12:00:00.000Z",
    rates: [
      { baseCurrency: "EUR", quoteCurrency: "UAH", decimal: "48.196", numerator: "12049", denominator: "250", sourceSeriesOrValcode: "EUR" },
      { baseCurrency: "USD", quoteCurrency: "UAH", decimal: "41.3203", numerator: "413203", denominator: "10000", sourceSeriesOrValcode: "USD" },
    ],
  };
  assert.deepEqual(plain(buildRateForPair(nbu, "EUR", "USD")), { numerator: "481960", denominator: "413203", sourceRates: ["EUR/UAH", "USD/UAH"] });
  const ecb = { ...nbu, provider: "ECB", rates: [{ baseCurrency: "EUR", quoteCurrency: "USD", decimal: "1.1715", numerator: "2343", denominator: "2000", sourceSeriesOrValcode: "EXR/D.USD.EUR.SP00.A" }] };
  assert.throws(() => buildRateForPair(ecb, "EUR", "UAH"), /не поддерживает/);
});

test("official NBU refresh stores provenance and exact decimal rates", async () => {
  const calls = [];
  const fetcher = async url => {
    calls.push(url);
    const eur = String(url).endsWith("EUR");
    return { ok: true, text: async () => JSON.stringify([{ rate: eur ? 48.196 : 41.3203, cc: eur ? "EUR" : "USD", exchangedate: "01.09.2025" }]) };
  };
  const result = plain(await fetchOfficialRates("NBU", fetcher, new Date("2025-09-01T16:00:00.000Z")));
  assert.equal(calls.length, 2);
  assert.equal(result.provider, "NBU");
  assert.equal(result.effectiveDate, "2025-09-01");
  assert.equal(result.fetchedAt, "2025-09-01T16:00:00.000Z");
  assert.equal(result.rates[0].decimal, "48.196");
  assert.equal(result.rates[0].numerator, "12049");
});

test("official refresh accepts a weekend observation but rejects an implausibly old effective date", async () => {
  const responseFor = exchangedate => async url => {
    const eur = String(url).endsWith("EUR");
    return { ok: true, text: async () => JSON.stringify([{ rate: eur ? 48.196 : 41.3203, cc: eur ? "EUR" : "USD", exchangedate }]) };
  };
  await assert.doesNotReject(() => fetchOfficialRates("NBU", responseFor("09.10.2026"), new Date("2026-10-12T08:00:00.000Z")));
  await assert.rejects(
    () => fetchOfficialRates("NBU", responseFor("02.10.2026"), new Date("2026-10-12T08:00:00.000Z")),
    /дата.*устарела/i,
  );
});

test("NBU accepts its published next-day rate but rejects a later future date", async () => {
  const responseFor = exchangedate => async url => {
    const eur = String(url).endsWith("EUR");
    return { ok: true, text: async () => JSON.stringify([{ rate: eur ? 50.3138 : 44.8894, cc: eur ? "EUR" : "USD", exchangedate }]) };
  };
  await assert.doesNotReject(
    () => fetchOfficialRates("NBU", responseFor("12.10.2026"), new Date("2026-10-11T15:35:00.000Z")),
  );
  await assert.rejects(
    () => fetchOfficialRates("NBU", responseFor("13.10.2026"), new Date("2026-10-11T15:35:00.000Z")),
    /дата.*будущ/i,
  );
});

test("NBU next-day validation follows the Europe/Kyiv calendar after local midnight", async () => {
  const responseFor = exchangedate => async url => {
    const eur = String(url).endsWith("EUR");
    return { ok: true, text: async () => JSON.stringify([{ rate: eur ? 50.3138 : 44.8894, cc: eur ? "EUR" : "USD", exchangedate }]) };
  };
  const afterKyivMidnight = new Date("2026-10-11T21:30:00.000Z");
  await assert.doesNotReject(() => fetchOfficialRates("NBU", responseFor("13.10.2026"), afterKyivMidnight));
  await assert.rejects(() => fetchOfficialRates("NBU", responseFor("14.10.2026"), afterKyivMidnight), /дата.*будущ/i);
});

test("failed official response is rejected instead of producing a partial cache", async () => {
  const fetcher = async url => String(url).endsWith("EUR")
    ? { ok: true, text: async () => JSON.stringify([{ rate: 48.196, cc: "EUR", exchangedate: "01.09.2025" }]) }
    : { ok: false, status: 503, text: async () => "" };
  await assert.rejects(() => fetchOfficialRates("NBU", fetcher), /HTTP 503/);
});

test("provider change invalidates the old cache and is audited in one transaction", async () => {
  const writes = { deleted: 0, audits: [] };
  const tx = {
    $executeRawUnsafe: async () => 1,
    appSetting: {
      findUnique: async () => ({ id: "provider", value: "ECB" }),
      upsert: async ({ update }) => ({ id: "provider", section: "finance", key: "exchangeRateProvider", value: update.value }),
      deleteMany: async () => { writes.deleted++; },
    },
    auditLog: { create: async ({ data }) => writes.audits.push(data) },
  };
  const service = new ExchangeRatesService({ $transaction: callback => callback(tx) });
  const result = plain(await service.setProvider("NBU", { id: "owner-1" }));
  assert.equal(writes.deleted, 1);
  assert.equal(writes.audits.length, 1);
  assert.equal(result.provider, "NBU");
  assert.equal(result.cache, null);
});

test("refresh failure never opens a write transaction and preserves the previous cache", async () => {
  let transactionCalled = false;
  const prisma = {
    appSetting: { findUnique: async () => ({ value: "ECB" }) },
    $transaction: async () => { transactionCalled = true; },
  };
  const service = new ExchangeRatesService(prisma);
  await assert.rejects(() => service.refresh({ id: "owner-1" }, async () => ({ ok: false, status: 503, text: async () => "" })), /Не удалось получить/);
  assert.equal(transactionCalled, false);
});

const ensureNow = new Date("2026-10-18T08:00:00.000Z");
const ensureActor = { id: "accountant-1" };
function ensureFixture({ provider = "NBU", fetchedAt = "2026-10-10T08:00:00.000Z", effectiveDate = "2026-10-16" } = {}) {
  const cache = provider === "NBU" ? {
    version: 1, provider, officialUrl: "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangeNew", effectiveDate, fetchedAt,
    rates: [
      { baseCurrency: "EUR", quoteCurrency: "UAH", decimal: "48", numerator: "48", denominator: "1", sourceSeriesOrValcode: "EUR" },
      { baseCurrency: "USD", quoteCurrency: "UAH", decimal: "40", numerator: "40", denominator: "1", sourceSeriesOrValcode: "USD" },
    ],
  } : {
    version: 1, provider, officialUrl: "https://data.ecb.europa.eu/help/api/data", effectiveDate, fetchedAt,
    rates: [{ baseCurrency: "EUR", quoteCurrency: "USD", decimal: "1.2", numerator: "6", denominator: "5", sourceSeriesOrValcode: "EXR/D.USD.EUR.SP00.A" }],
  };
  const state = { provider, cache, calls: [], locks: [], audits: [], transactions: 0 };
  const appSetting = {
    findUnique: async ({ where }) => ({ id: where.section_key.key, value: where.section_key.key === "exchangeRateProvider" ? state.provider : state.cache }),
    upsert: async ({ update }) => { state.cache = update.value; return { id: "exchangeRateCache", value: state.cache }; },
  };
  const tx = {
    appSetting,
    $executeRawUnsafe: async (...args) => { state.locks.push(args); },
    auditLog: { create: async ({ data }) => { state.audits.push(data); } },
  };
  const service = new ExchangeRatesService({ appSetting, $transaction: async callback => { state.transactions++; return callback(tx); } });
  const fetcher = async url => {
    state.calls.push(url);
    if (String(url).includes("ecb.europa.eu")) return { ok: true, text: async () => "CURRENCY,CURRENCY_DENOM,TIME_PERIOD,OBS_VALUE,OBS_STATUS\nUSD,EUR,2026-10-16,1.2,A\n" };
    const currency = String(url).endsWith("EUR") ? "EUR" : "USD";
    return { ok: true, text: async () => JSON.stringify([{ rate: currency === "EUR" ? 48 : 40, cc: currency, exchangedate: "16.10.2026" }]) };
  };
  return { service, state, fetcher };
}

test("ensure-current refreshes a cache fetched more than seven days ago through audited refresh", async () => {
  const { service, state, fetcher } = ensureFixture();
  const result = await service.ensureCurrent(ensureActor, fetcher, ensureNow);
  assert.equal(result.cache.fetchedAt, ensureNow.toISOString());
  assert.equal(result.provider, "NBU");
  assert.equal(result.cache.effectiveDate, "2026-10-16");
  assert.equal(state.calls.length, 2);
  assert.equal(state.audits.length, 1);
  assert.equal(state.audits[0].actorId, ensureActor.id);
  assert.equal(state.locks[0][1], "yoleotard-exchange-rates");
});

test("parallel ensure-current requests share one selected-provider fetch and audit", async () => {
  const { service, state, fetcher } = ensureFixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const delayedFetch = async url => { await gate; return fetcher(url); };
  const pending = Array.from({ length: 20 }, () => service.ensureCurrent(ensureActor, delayedFetch, ensureNow));
  await new Promise(resolve => setImmediate(resolve));
  release();
  const results = await Promise.all(pending);
  assert.equal(state.calls.length, 2);
  assert.equal(state.audits.length, 1);
  assert.ok(results.every(result => result.cache.fetchedAt === ensureNow.toISOString()));
});

test("ensure-current refreshes yesterday's fetchedAt even with a current effective date", async () => {
  const { service, state, fetcher } = ensureFixture({ fetchedAt: "2026-10-17T20:00:00.000Z", effectiveDate: "2026-10-18" });
  const result = await service.ensureCurrent(ensureActor, fetcher, ensureNow);
  assert.equal(result.cache.fetchedAt, ensureNow.toISOString());
  assert.equal(state.calls.length, 2);
});

test("ensure-current reuses today's weekend official cache without fetching or auditing", async () => {
  const { service, state } = ensureFixture({ fetchedAt: "2026-10-18T01:00:00.000Z" });
  const result = await service.ensureCurrent(ensureActor, async () => { assert.fail("must reuse cache"); }, ensureNow);
  assert.equal(result.cache.fetchedAt, "2026-10-18T01:00:00.000Z");
  assert.equal(result.cache.effectiveDate, "2026-10-16");
  assert.equal(state.transactions, 0);
});

test("ensure-current uses the Kyiv business day rather than UTC or elapsed 24 hours", async () => {
  // Both timestamps are October 18 in Kyiv, but different UTC dates.
  const sameDay = ensureFixture({ fetchedAt: "2026-10-17T21:30:00.000Z" });
  const reused = await sameDay.service.ensureCurrent(ensureActor, async () => { assert.fail("same Kyiv day"); }, ensureNow);
  assert.equal(reused.cache.fetchedAt, "2026-10-17T21:30:00.000Z");
  // These timestamps share a UTC date but straddle Kyiv midnight.
  const priorDay = ensureFixture({ fetchedAt: "2026-10-17T20:30:00.000Z" });
  const refreshed = await priorDay.service.ensureCurrent(ensureActor, priorDay.fetcher, new Date("2026-10-17T21:30:00.000Z"));
  assert.equal(refreshed.cache.fetchedAt, "2026-10-17T21:30:00.000Z");
  assert.equal(priorDay.state.calls.length, 2);
});

test("ensure-current still rejects stale official dates and future fetchedAt even if fetched today", async () => {
  for (const settings of [
    { fetchedAt: "2026-10-18T01:00:00.000Z", effectiveDate: "2026-10-10" },
    { fetchedAt: "2026-10-18T09:00:00.000Z" },
    { fetchedAt: "2026-10-18T01:00:00.000Z", effectiveDate: "2026-10-20" },
  ]) {
    const { service, state, fetcher } = ensureFixture(settings);
    const result = await service.ensureCurrent(ensureActor, fetcher, ensureNow);
    assert.equal(result.cache.fetchedAt, ensureNow.toISOString());
    assert.equal(result.cache.effectiveDate, "2026-10-16");
    assert.equal(state.calls.length, 2);
  }
});

test("ensure-current refreshes missing, damaged or other-provider cache using the selected provider only", async () => {
  for (const cache of [null, { version: 99 }, ensureFixture({ provider: "ECB" }).state.cache]) {
    const { service, state, fetcher } = ensureFixture();
    state.cache = cache;
    const result = await service.ensureCurrent(ensureActor, fetcher, ensureNow);
    assert.equal(result.cache.provider, "NBU");
    assert.equal(state.calls.length, 2);
    assert.ok(state.calls.every(url => url.startsWith("https://bank.gov.ua/")));
  }
});

test("ensure-current never falls back from selected ECB to NBU for UAH", async () => {
  const { service, state, fetcher } = ensureFixture({ provider: "ECB" });
  const result = await service.ensureCurrent(ensureActor, fetcher, ensureNow);
  assert.equal(state.calls.length, 1);
  assert.match(state.calls[0], /^https:\/\/data-api.ecb.europa.eu\//);
  assert.equal(result.provider, "ECB");
  assert.throws(() => buildRateForPair(result.cache, "UAH", "EUR"), /не поддерживает/);
});

test("failed parallel ensure-current preserves the old cache, rejects all callers and allows retry", async () => {
  const { service, state, fetcher } = ensureFixture();
  const before = plain((await service.status()).cache);
  let calls = 0;
  const failedFetch = async () => { calls++; return { ok: false, status: 503 }; };
  const results = await Promise.allSettled(Array.from({ length: 10 }, () => service.ensureCurrent(ensureActor, failedFetch, ensureNow)));
  assert.ok(results.every(result => result.status === "rejected" && /Не удалось получить/.test(result.reason.message)));
  assert.equal(calls, 2);
  assert.deepEqual(plain((await service.status()).cache), before);
  assert.equal(state.transactions, 0);
  assert.equal(state.audits.length, 0);
  const retry = await service.ensureCurrent(ensureActor, fetcher, ensureNow);
  assert.equal(retry.cache.fetchedAt, ensureNow.toISOString());
  assert.equal(state.audits.length, 1);
});

test("freshly fetched but stale official observations reject without replacing the old cache", async () => {
  const { service, state } = ensureFixture();
  const before = plain((await service.status()).cache);
  const staleFetch = async url => ({ ok: true, text: async () => JSON.stringify([
    { cc: String(url).endsWith("EUR") ? "EUR" : "USD", rate: 40, exchangedate: "10.10.2026" },
  ]) });
  await assert.rejects(() => service.ensureCurrent(ensureActor, staleFetch, ensureNow), /устарела/);
  assert.deepEqual(plain((await service.status()).cache), before);
  assert.equal(state.transactions, 0);
});

test("provider change keeps the refresh conflict guard and does not coalesce different providers", async () => {
  const { service, state, fetcher } = ensureFixture();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const oldRequest = service.ensureCurrent(ensureActor, async url => { await gate; return fetcher(url); }, ensureNow);
  const oldResult = assert.rejects(oldRequest, /Источник курсов изменился/);
  await new Promise(resolve => setImmediate(resolve));
  // Another administrator changes the selected provider and invalidates its cache.
  state.provider = "ECB";
  state.cache = null;
  const newResult = await service.ensureCurrent(ensureActor, fetcher, ensureNow);
  assert.equal(newResult.provider, "ECB");
  release();
  await oldResult;
  assert.equal((await service.status()).cache.provider, "ECB");
  assert.equal(state.audits.length, 1);
  assert.equal(state.calls.filter(url => url.includes("bank.gov.ua")).length, 2);
  assert.equal(state.calls.filter(url => url.includes("ecb.europa.eu")).length, 1);
});

test("legacy currentOrRefresh retains its seven-day cache policy for payment and shipment consumers", async () => {
  const { service, state } = ensureFixture({ fetchedAt: "2026-10-17T08:00:00.000Z" });
  const result = await service.currentOrRefresh(ensureActor, async () => { assert.fail("legacy cache remains valid"); }, ensureNow);
  assert.equal(result.fetchedAt, "2026-10-17T08:00:00.000Z");
  assert.equal(state.transactions, 0);
});
