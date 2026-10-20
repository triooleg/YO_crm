import test from "node:test";
import assert from "node:assert/strict";
import {
  requiresProduction,
  productionSetting,
  productionWindow,
  resolveProductionSlotTentative,
  violatesShippingLead,
} from "../src/orders/production-rules.ts";

test("готовые модели и аксессуары не требуют планирования производства", () => {
  assert.equal(requiresProduction("READY_MODEL"), false);
  assert.equal(requiresProduction("WEBSITE_SALE"), false);
  assert.equal(requiresProduction("STOCK_SALE"), false);
  assert.equal(requiresProduction("ACCESSORY"), false);
  for (const type of ["CUSTOM_ORDER", "COPY_MODEL", "MODIFIED_MODEL", "PAIR", "GROUP_ORDER", "REPEAT_ORDER"]) {
    assert.equal(requiresProduction(type), true, type);
  }
});

test("production settings use validated persisted integers and safe defaults", () => {
  assert.equal(productionSetting(14, 7, 1, 90), 14);
  assert.equal(productionSetting(0, 7, 1, 90), 7);
  assert.equal(productionSetting(2.5, 2, 0, 30), 2);
});

test("production window uses inclusive duration and shipping reserve", () => {
  const window = productionWindow(new Date("2026-09-20T00:00:00.000Z"), 7, 2);
  assert.equal(window.endsAt.toISOString(), "2026-09-18T00:00:00.000Z");
  assert.equal(window.startsAt.toISOString(), "2026-09-12T00:00:00.000Z");
});

test("shipping boundary is accepted and any later end is rejected", () => {
  const shipping = new Date("2026-09-20T00:00:00.000Z");
  assert.equal(violatesShippingLead(new Date("2026-09-18T00:00:00.000Z"), shipping, 2), false);
  assert.equal(violatesShippingLead(new Date("2026-09-18T00:00:00.001Z"), shipping, 2), true);
});

test("slot remains tentative below deposit and confirms at the threshold", () => {
  assert.equal(resolveProductionSlotTentative(4999, 5000), true);
  assert.equal(resolveProductionSlotTentative(5000, 5000, true), false);
});
