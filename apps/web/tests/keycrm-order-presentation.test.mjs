import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const orderTypes = readFileSync(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const orderService = readFileSync(new URL("../../api/src/orders/orders.service.ts", import.meta.url), "utf8");

test("страница заказов показывает безопасные изображения и данные, импортированные из KeyCRM", () => {
  assert.match(orderTypes, /externalImageUrl\?:string/);
  assert.match(dashboard, /item\.externalImageUrl/);
  assert.match(orderService, /externalImageUrl:\s*true/);
  assert.match(orderService, /taxMinor:\s*true/);
  assert.match(orderService, /buyerComment:\s*true/);
  assert.match(orderService, /sourceSystem:\s*true/);
});
