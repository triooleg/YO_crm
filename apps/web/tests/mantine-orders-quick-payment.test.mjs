import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");

test("быстрая оплата использует общие Mantine-контролы CRM", () => {
  const start = source.indexOf("function QuickPayment");
  const end = source.indexOf("function OrderClientPicker", start);
  const payment = source.slice(start, end);

  assert.match(payment, /<Modal opened/);
  assert.match(payment, /<CrmTextInput/);
  assert.match(payment, /<CrmNativeSelect/);
  assert.match(payment, /<CrmAlert/);
  assert.match(payment, /<CrmButton/);
  assert.doesNotMatch(payment, /orders-drawer-overlay/);
  assert.doesNotMatch(payment, /bindDialogKeyboard/);
});

test("быстрая оплата сохраняет прежний API-контракт", () => {
  assert.match(source, /amountMinor:\s*Math\.round\(value \* 100\)/);
  assert.match(source, /currency:\s*order\.currency/);
  assert.match(source, /receivedAt:\s*new Date\(`\$\{receivedAt\}T12:00:00`\)\.toISOString\(\)/);
  assert.match(source, /reference:\s*reference\.trim\(\) \|\| undefined/);
  assert.match(source, /notes:\s*notes\.trim\(\) \|\| undefined/);
  assert.match(source, /`\/orders\/\$\{order\.id\}\/payments`/);
});
