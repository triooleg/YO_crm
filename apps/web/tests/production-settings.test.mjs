import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const settings = await readFile(new URL("../components/settings-workspace.tsx", import.meta.url), "utf8");
const production = await readFile(new URL("../components/production-workspace.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("owner and admin can edit localized production defaults", () => {
  assert.match(settings, /ProductionSettings/);
  assert.match(settings, /role===\"OWNER\"\|\|role===\"ADMIN\"/);
  assert.match(settings, /defaultDurationDays/);
  assert.match(settings, /shippingLeadDays/);
  assert.match(settings, /\/api\/finance\/settings\/production/);
  assert.match(settings, /disabled=\{saving\|\|!loaded\}/);
  assert.doesNotMatch(settings, /for\(const key of \["defaultDurationDays","shippingLeadDays"\]/);
  assert.match(i18n, /productionSettingsTitle/);
  assert.match(i18n, /productionDurationHint/);
  assert.match(i18n, /shippingLeadDaysHint/);
});

test("production planner uses server defaults for scheduling and drag limits", () => {
  assert.match(production, /fetch\("\/api\/orders\/defaults"/);
  assert.match(production, /ProductionSettings/);
  assert.match(production, /shippingLeadDays/);
  assert.match(production, /defaultDurationDays/);
  assert.match(production, /useState<ProductionSettings \| null>\(null\)/);
  assert.match(production, /!ordersResponse\.ok \|\| !defaultsResponse\.ok/);
  assert.doesNotMatch(production, /defaultDurationDays:\s*7,shippingLeadDays:\s*2/);
  assert.match(production, /productionAddDays\(order\.requiredDeliveryAt, -productionSettings\.shippingLeadDays\)/);
});
