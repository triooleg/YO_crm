import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const orders = readFileSync(new URL("../src/orders/orders.service.ts", import.meta.url), "utf8");
const finance = readFileSync(new URL("../src/finance/finance.service.ts", import.meta.url), "utf8");
const communications = readFileSync(new URL("../src/communications/communications.service.ts", import.meta.url), "utf8");
const keycrm = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");

test("аннулированные внешние оплаты сохраняются в истории, но исключаются из рабочих проекций", () => {
  assert.match(keycrm, /voidedAt:\s*new Date\(\)/);
  assert.match(keycrm, /action:\s*"VOID"/);
  assert.match(orders, /payments:\s*\{\s*where:\s*\{\s*voidedAt:\s*null/);
  assert.match(finance, /payments:\{where:\{voidedAt:null\}/);
  assert.equal((communications.match(/payments:\s*\{\s*where:\s*\{\s*voidedAt:\s*null/g) || []).length >= 2, true);
});

test("повторная синхронизация не меняет экономические поля существующей оплаты", () => {
  assert.match(keycrm, /previous\.amountMinor !== payment\.amountMinor/);
  assert.match(keycrm, /previous\.currency !== payment\.currency/);
  const paidUpdate = keycrm.slice(keycrm.indexOf("if (payment.isPaid)"), keycrm.indexOf("const activePayments"));
  assert.doesNotMatch(paidUpdate, /update:\s*\{[^}]*amountMinor|update:\s*\{[^}]*currency|update:\s*\{[^}]*receivedAt/s);
});

test("KeyCRM и финансовая сводка используют применённую сумму валютного платежа", () => {
  assert.match(keycrm, /select:\s*\{\s*amountMinor:\s*true,\s*currency:\s*true,\s*appliedAmountMinor:\s*true,\s*appliedCurrency:\s*true\s*\}/);
  assert.match(finance, /appliedPaymentMinor\(payment,\s*currency\)/);
});
