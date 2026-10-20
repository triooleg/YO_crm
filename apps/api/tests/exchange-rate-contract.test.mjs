import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const controller = readFileSync(new URL("../src/finance/finance.controller.ts", import.meta.url), "utf8");
const financeDto = readFileSync(new URL("../src/finance/finance.dto.ts", import.meta.url), "utf8");
const ordersController = readFileSync(new URL("../src/orders/orders.controller.ts", import.meta.url), "utf8");
const ordersDto = readFileSync(new URL("../src/orders/orders.dto.ts", import.meta.url), "utf8");
const ordersService = readFileSync(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const exchange = readFileSync(new URL("../src/finance/exchange-rates.ts", import.meta.url), "utf8");
const currency = readFileSync(new URL("../src/orders/order-currency.ts", import.meta.url), "utf8");
const appModule = readFileSync(new URL("../src/app.module.ts", import.meta.url), "utf8");

test("exchange-rate status is read-only for managers while mutations remain owner/admin", () => {
  assert.match(controller, /@Get\("exchange-rates"\) @Roles\("OWNER","ADMIN","MANAGER"\)/);
  assert.match(controller, /@Patch\("exchange-rates\/settings"\) @Roles\("OWNER","ADMIN"\)/);
  assert.match(controller, /@Post\("exchange-rates\/refresh"\) @Roles\("OWNER","ADMIN"\)/);
  assert.match(financeDto, /class UpdateExchangeRateProviderDto/);
  assert.match(financeDto, /@IsIn\(\["ECB","NBU"\]\)/);
  assert.match(appModule, /ExchangeRatesService/);
});

test("order currency endpoint validates supported ISO currencies and delegates to an atomic transaction", () => {
  assert.match(ordersController, /@Patch\(":id\/currency"\)/);
  assert.match(ordersDto, /class UpdateOrderCurrencyDto/);
  assert.match(ordersDto, /@IsIn\(\["EUR", "USD", "UAH"\]\)/);
  const method = ordersService.slice(ordersService.indexOf("async updateCurrency"), ordersService.indexOf("async updateDiscipline"));
  assert.match(method, /\$transaction/);
  assert.match(method, /changeOrderCurrencyTransaction/);
});

test("official provider adapters use fixed HTTPS URLs, timeout and no API keys", () => {
  assert.match(exchange, /https:\/\/data-api\.ecb\.europa\.eu/);
  assert.match(exchange, /https:\/\/bank\.gov\.ua/);
  assert.match(exchange, /FETCH_TIMEOUT_MS = 8_000/);
  assert.match(exchange, /AbortController/);
  assert.doesNotMatch(exchange, /api[_-]?key|authorization/i);
});

test("currency mutation locks the order and preserves exact rate evidence", () => {
  assert.match(currency, /EXCHANGE_RATE_ADVISORY_LOCK/);
  assert.match(currency, /payments: true, invoices: true, expenses: true, shipment: true, items: true/);
  assert.match(currency, /ORDER_CURRENCY_CHANGED/);
  assert.match(currency, /numerator: rate\.numerator, denominator: rate\.denominator/);
  assert.match(currency, /sourceObservations/);
  assert.match(currency, /sourceSystem.*KEYCRM/);
});

test("provider changes and currency conversion share one transaction lock", () => {
  assert.match(exchange, /export const EXCHANGE_RATE_ADVISORY_LOCK/);
  assert.match(exchange, /pg_advisory_xact_lock\(hashtext\(\$1\)\).*EXCHANGE_RATE_ADVISORY_LOCK/s);
  assert.match(currency, /pg_advisory_xact_lock\(hashtext\(\$1\)\).*EXCHANGE_RATE_ADVISORY_LOCK/s);
});

test("manual production slot edits release KeyCRM ownership", () => {
  const method = ordersService.slice(ordersService.indexOf("async updateProductionSlot"), ordersService.indexOf("async addPayment"));
  assert.match(method, /sourceSystem:null/);
  assert.match(method, /sourceAccount:null/);
  assert.match(method, /externalId:null/);
});
