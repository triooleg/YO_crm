import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace=readFileSync(new URL("../components/orders-workspace.tsx",import.meta.url),"utf8");
const i18n=readFileSync(new URL("../lib/i18n.ts",import.meta.url),"utf8");
const css=readFileSync(new URL("../app/orders-workspace.css",import.meta.url),"utf8");

test("устаревший список больше не открывает отдельную карточку заказа",()=>{
  assert.match(workspace,/OrderWorkspaceCard/);
  assert.doesNotMatch(workspace,/workspaceId|setWorkspaceId/);
  assert.match(workspace,/orders-card-workspace/);
  assert.match(workspace,/onBack/);
});

test("карточка показывает четыре статуса состав замеры оплату доставку и историю",()=>{
  for(const token of ["salesStatus","paymentStatus","productionStatus","shippingStatus","GroupMeasurementSizes","payments","activities"]){assert.match(workspace,new RegExp(token))}
  assert.match(workspace,/\/statuses/);
  assert.match(workspace,/measurement\.values/);
  for(const label of ["Карточка заказа","Изделие и замеры","Оплата","Доставка и контакты","История заказа"]){assert.match(i18n,new RegExp(label))}
});

test("полноценная карточка адаптируется без горизонтального смешения блоков",()=>{
  assert.match(css,/\.orders-card-workspace/);
  assert.match(css,/\.orders-card-grid/);
  assert.match(css,/@media\(max-width:900px\)/);
});

test("исторический индивидуальный заказ без позиций сохраняет изделие и замеры",()=>{
  assert.match(workspace,/function cardItems/);
  assert.match(workspace,/legacy-/);
  assert.match(workspace,/measurement:o\.measurement/);
});

test("shipping status is read only in the generic order card",()=>{
  assert.doesNotMatch(workspace,/field:"salesStatus"\|"productionStatus"\|"shippingStatus"/);
  assert.doesNotMatch(workspace,/status\("shippingStatus"/);
  assert.match(workspace,/orderLabel\("shipping",o\.shippingStatus\)/);
});
