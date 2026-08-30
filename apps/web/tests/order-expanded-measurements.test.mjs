import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const workspace = await readFile(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const panel = await readFile(new URL("../components/measurement-panel.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const css = await readFile(new URL("../app/orders-workspace.css", import.meta.url), "utf8");

test("раскрытый индивидуальный заказ без замеров предлагает добавить снимок", () => {
  assert.match(workspace, /import \{ MeasurementPanel \}/);
  assert.match(workspace, /ordersUi\.addMeasurements/);
  assert.match(workspace, /setMeasurementOrder\(o\)/);
  assert.match(workspace, /function measurementAthlete\(o:Order\)/);
  assert.match(workspace, /o\.athlete\?\?o\.items\[0\]\?\.athlete/);
  assert.match(css, /\.orders-add-measurements/);
});

test("там же существующие замеры открываются для редактирования", () => {
  assert.match(workspace, /primaryMeasurement\(o\)\?ordersUi\.editMeasurements:ordersUi\.addMeasurements/);
  assert.match(workspace, /initialValues=\{primaryMeasurement\(measurementOrder\)\?\.values\}/);
  assert.match(workspace, /expectedMeasurementId=\{primaryMeasurement\(measurementOrder\)\?\.id\}/);
  assert.match(i18n, /editMeasurements:\s*"Редактировать замеры"/);
  assert.match(i18n, /editMeasurementDialogTitle:\s*"Редактировать замеры заказа"/);
  assert.match(panel, /initialValues\?:Record<string,number>/);
  assert.match(panel, /initialMeasurementValues\(initialValues\)/);
  assert.match(panel, /expectedMeasurementId\?:string/);
  assert.match(panel, /expectedMeasurementId/);
  assert.match(panel, /const standardHeight=initialValues\?chosen:nearest/);
});

test("замеры из заказа открываются модально и обновляют список после сохранения", () => {
  assert.match(workspace, /measurementOrder&&/);
  assert.match(workspace, /orderId=\{measurementOrder\.id\}/);
  assert.match(workspace, /onSaved=\{async\(\)=>/);
  assert.match(workspace, /await load\(\)/);
  assert.match(i18n, /addMeasurements:\s*"\+ Добавить замеры"/);
  assert.match(i18n, /measurementDialogTitle:\s*"Замеры для заказа"/);
  assert.match(panel, /role="dialog"/);
  assert.match(panel, /aria-modal="true"/);
  assert.match(panel, /panelRef/);
  assert.match(panel, /previousFocus/);
  assert.match(panel, /e\.key==="Escape"/);
  assert.match(panel, /e\.key!=="Tab"/);
});

test("ростовой стандарт заполняет редактируемые поля до создания snapshot", () => {
  assert.match(panel, /function usePreset\(h:number\)/);
  assert.match(panel, /setValues/);
  assert.match(panel, /onChange=\{e=>setValues/);
  assert.match(panel, /orderId\?`\/orders\/\$\{orderId\}\/measurement`/);
});
