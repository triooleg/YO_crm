import assert from "node:assert/strict";
import test from "node:test";
import { orderMeasurementState } from "../lib/order-measurement-state.ts";

const athlete = { id: "athlete-1" };
const owned = { athleteId: athlete.id };
const foreign = { athleteId: "athlete-2" };

test('physical assignments determine readiness and missing new costume is not hidden by a legacy item snapshot',()=>{
 const instances=Array.from({length:6},(_,i)=>({id:`p${i}`,athlete:{id:`a${i}`},measurement:{athleteId:`a${i}`}}));
 const order={type:'GROUP_ORDER',items:[{id:'d',quantity:6,instances}]};assert.equal(orderMeasurementState(order).complete,true);
 order.items[0].athlete=athlete;order.items[0].measurement=owned;order.items[0].instances.push({id:'new'});order.items[0].quantity=7;assert.equal(orderMeasurementState(order).complete,false);
 assert.equal(orderMeasurementState({type:'CUSTOM_ORDER',compositionManaged:true,items:[]}).complete,true);
});

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
