import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const orderTypes = readFileSync(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const orderService = readFileSync(new URL("../../api/src/orders/orders.service.ts", import.meta.url), "utf8");
const production = readFileSync(new URL("../components/production-workspace.tsx", import.meta.url), "utf8");
const productionView = readFileSync(new URL("../lib/production-view.ts", import.meta.url), "utf8");

test("страница заказов показывает только локально проверенные изображения KeyCRM", () => {
  assert.match(orderTypes, /externalImageUrl\?:string/);
  assert.match(orderService, /externalImageUrl:\s*true/);
  assert.match(dashboard, /function itemImage[\s\S]*modelImagePath[\s\S]*: null/);
  assert.doesNotMatch(dashboard, /if \(order\.externalImageUrl\) paths\.unshift/);
  assert.match(orderService, /taxMinor:\s*true/);
  assert.match(orderService, /buyerComment:\s*true/);
  assert.match(orderService, /sourceSystem:\s*true/);
  assert.match(productionView, /externalImageUrl\?: string/);
  assert.match(productionView, /return stored \? `\/api\/orders\/images\/\$\{stored\}` : undefined/);
  assert.doesNotMatch(productionView, /return order\.externalImageUrl/);
});
