import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const copy = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const settings = await readFile(new URL("../components/settings-workspace.tsx", import.meta.url), "utf8");

test("expanded order exposes an explicit audited currency change action", () => {
  assert.match(dashboard, /changeCurrency/);
  assert.match(dashboard, /\/orders\/\$\{[^}]+\}\/currency/);
  assert.match(dashboard, /currencyChangeOrder/);
  assert.match(dashboard, /<Modal[\s\S]*currencyChange/);
});

test("currency change UI explains official source and fail-closed history policy in Russian", () => {
  for (const phrase of ["Изменить валюту", "официальному курсу", "оплат", "инвойс", "доставк"])
    assert.match(copy, new RegExp(phrase, "i"));
});

test("exchange provider cannot be mutated before settings load or by a read-only role", () => {
  assert.match(settings, /disabled=\{!data\|\|busy\|\|!canManage\}/);
  assert.match(settings, /\{canManage&&<div className="settings-actions">/);
  assert.match(copy, /exchangeRates:[\s\S]*readOnly/);
});
