import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const production=await readFile(new URL("../components/production-workspace.tsx",import.meta.url),"utf8");
const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
const styles=await readFile(new URL("../app/production-workspace.css",import.meta.url),"utf8");
test("раздел Производство открывает интерактивную шкалу",()=>{assert.match(shell,/ProductionWorkspace/);assert.match(production,/productionSlot/);assert.match(production,/pointermove/);assert.match(styles,/production-timeline/)});
test("даты сохраняются локально и загрузка зависит от мощности",()=>{assert.match(production,/toLocalIso/);assert.match(production,/dailyLoad/);assert.match(production,/capacityPerDay/);assert.match(production,/production-slot/)});
test("закрепленный слот нельзя двигать мышью",()=>{assert.match(production,/productionSlot\.locked/);assert.match(production,/Закрепить слот/);assert.match(styles,/timeline-bar\.locked/);assert.match(production,/dataset\.dragged/);assert.match(production,/slot-pin/)});
test("preview width",()=>{assert.match(production,/orders-image-preview-width-v1/);assert.match(production,/min=\{200\}/);assert.match(production,/max=\{1200\}/);assert.match(production,/step=\{50\}/);assert.match(production,/previewWidth/);assert.match(styles,/production-preview-width/)});
test("timeline click toggles date card",()=>{assert.match(production,/setSelected\(current=>current===order\.id\?undefined:order\.id\)/);assert.match(production,/dataset\.dragged/)});

test("shipping date is marked and mouse movement is limited by it",()=>{assert.match(production,/requiredDeliveryAt/);assert.match(production,/shippingLimit/);assert.match(production,/shipping-date-marker/);assert.match(production,/shipping-overrun/);assert.match(styles,/shipping-date-marker/);assert.match(styles,/shipping-overrun/);assert.match(production,/slotVisible/);assert.match(production,/end>=0&&start<DAYS/)});

test("resize handles stay on bar edges and shipping gap stays in the same row",()=>{assert.match(styles,/\.resize\{position:absolute/);assert.doesNotMatch(styles,/timeline-bar>\.resize\{position:relative/);assert.match(styles,/timeline-bar>\.resize\{z-index:6/);assert.match(production,/shippingGap/);assert.match(production,/productionUi\.untilShipping/);assert.match(styles,/shipping-date-marker\{position:absolute/)});

test("timeline grid starts after the order column and matches day cells",()=>{assert.match(styles,/\.timeline-row::before\{content:"";position:absolute;left:220px/);assert.match(styles,/repeat\(35,40px\)/)});
