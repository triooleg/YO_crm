import assert from "node:assert/strict";
import test from "node:test";
import { orderMeasurementState } from "../lib/order-measurement-state.ts";

const athlete = { id: "athlete-1" };
const owned = { athleteId: athlete.id };
const foreign = { athleteId: "athlete-2" };

test("чужой снимок мерок считается отсутствующим и требует действие «замеры»", () => {
  for (const order of [
    { type: "CUSTOM_ORDER", athlete, measurement: foreign, items: [] },
    { type: "CUSTOM_ORDER", athlete, items: [{ athlete, measurement: foreign }] },
    { type: "PAIR", items: [{ athlete, measurement: owned }, { athlete: { id: "athlete-2" }, measurement: { athleteId: "athlete-3" } }] },
    { type: "GROUP_ORDER", items: [{ athlete, measurement: foreign }] },
  ]) assert.deepEqual(orderMeasurementState(order), { complete: false, problem: "dimensions", nextAction: "dimensions" });
});

test("принадлежащие спортсменам снимки закрывают требование для одиночного, парного и группового заказа", () => {
  for (const order of [
    { type: "CUSTOM_ORDER", athlete, measurement: owned, items: [] },
    { type: "CUSTOM_ORDER", athlete, items: [{ athlete, measurement: owned }] },
    { type: "PAIR", items: [{ athlete, measurement: owned }, { athlete: { id: "athlete-2" }, measurement: { athleteId: "athlete-2" } }] },
    { type: "GROUP_ORDER", items: [{ athlete, measurement: owned }] },
  ]) assert.deepEqual(orderMeasurementState(order), { complete: true, problem: undefined, nextAction: undefined });
});
