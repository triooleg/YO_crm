import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("панель заказов использует общие Mantine-контролы CRM", () => {
  for (const control of ["CrmAlert", "CrmButton", "CrmNativeSelect", "CrmSearchField"]) {
    assert.match(dashboard, new RegExp(`\\b${control}\\b`));
  }
  assert.match(dashboard, /<Modal[\s\S]*aria-label=\{ui\.selectClient\}/);
  assert.match(dashboard, /orders-client-search[^>]*autoFocus/);
  assert.match(i18n, /clearSearch:\s*"Очистить поиск"/);
});

test("Mantine-миграция не меняет рабочие API заказов", () => {
  assert.match(dashboard, /`\/orders\/\$\{order\.id\}\/deadline`/);
  assert.match(dashboard, /JSON\.stringify\(\{ requiredDeliveryAt: value \}\)/);
  assert.match(dashboard, /`\/orders\/\$\{order\.id\}\/discipline`/);
  assert.match(dashboard, /JSON\.stringify\(\{discipline:value\}\)/);
  assert.match(dashboard, /`\/orders\/\$\{order\.id\}\/statuses`/);
  assert.match(dashboard, /JSON\.stringify\(\{ \[field\]: value \}\)/);
});

test("номер заказа, срок и создание заказа остаются интерактивными", () => {
  assert.match(dashboard, /orders-order-number[^>]*onClick=\{onExpand\}/);
  assert.match(dashboard, /showPicker\(\)[^\n]*orders-deadline-button/);
  assert.match(dashboard, /ref=\{newOrderTrigger\}[\s\S]*onClick=\{\(\) => openNewOrder\(\)\}/);
  assert.match(dashboard, /<OrderPanel client=\{newOrderClient\}/);
});
