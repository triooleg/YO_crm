import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const panel = readFileSync(new URL("../components/order-panel.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("order panel loads the configured deposit percent and recalculates from price", () => {
  assert.match(panel, /request\("\/orders\/defaults"\)/);
  assert.match(panel, /setDepositPercent/);
  assert.match(panel, /calculateDepositMinor\(priceMinor,depositPercent\)/);
  assert.match(panel, /value=\{depositDisplay\}/);
});

test("order panel strings for the calculated deposit are centralized", () => {
  assert.match(panel, /orderFormUi\.deposit/);
  assert.match(panel, /orderFormUi\.depositHint/);
  assert.match(i18n, /export const orderFormUi/);
});
