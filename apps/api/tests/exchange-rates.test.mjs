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
