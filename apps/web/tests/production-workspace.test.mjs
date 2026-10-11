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

test("shipping date is marked and mouse movement is limited by it",()=>{assert.match(production,/requiredDeliveryAt/);assert.match(production,/shippingLimit/);assert.match(production,/shipping-date-marker/);assert.match(production,/shipping-overrun/);assert.match(styles,/shipping-date-marker/);assert.match(styles,/shipping-overrun/);assert.match(production,/slotVisible/);assert.match(production,/end>=0&&start<dayCount/)});

test("resize handles stay on bar edges and shipping gap stays in the same row",()=>{assert.match(styles,/\.resize\{position:absolute/);assert.doesNotMatch(styles,/timeline-bar>\.resize\{position:relative/);assert.match(styles,/timeline-bar>\.resize\{z-index:6/);assert.match(production,/shippingGap/);assert.match(production,/productionUi\.untilShipping/);assert.match(styles,/shipping-date-marker\{position:absolute/)});

test("timeline grid starts after a content-aware order column and matches fixed-width day cells",()=>{assert.match(styles,/\.timeline-row::before\{left:var\(--order-column-width\)\}/);assert.match(styles,/var\(--order-column-width\) repeat\(var\(--timeline-days\),40px\)/);assert.match(styles,/width:var\(--timeline-width\)/);assert.doesNotMatch(styles,/var\(--timeline-days\) \* 40px/);assert.match(production,/MIN_ORDER_COLUMN_WIDTH=155/);assert.match(production,/MAX_ORDER_COLUMN_WIDTH=420/)});

test("timeline recalculates only fully visible days and fills the available width",()=>{assert.match(production,/ResizeObserver/);assert.match(production,/timelineRef/);assert.match(production,/Math\.floor\(available\/DAY_CELL_WIDTH\)/);assert.match(production,/width-nextDayCount\*DAY_CELL_WIDTH/);assert.match(production,/--timeline-width/);assert.match(production,/--timeline-days/);assert.match(styles,/\.production-timeline\{overflow-x:auto;overflow-y:hidden\}/);assert.doesNotMatch(production,/const DAY=86400000, DAYS=35/)});

test("production bars use two text lines and visible handles",()=>{assert.match(production,/timeline-bar-text/);assert.match(styles,/\.timeline-bar-text\{[^}]*display:grid/);assert.match(styles,/\.timeline-bar b\{font-size:11px/);assert.match(styles,/\.timeline-bar small\{font-size:9px/);assert.match(styles,/\.resize:after\{content:""/);assert.match(styles,/\.timeline-bar\.locked \.resize\{display:none/)});

test("production workspace loads its dedicated projection",()=>{assert.match(production,/productionUrl/);assert.match(production,/\/api\/orders\/production/);assert.doesNotMatch(production,/fetch\("\/api\/orders",\{credentials:"include"\}\)/)});

test("production workspace requests a bounded visible date range",()=>{assert.match(production,/new URLSearchParams\(\{from:toLocalIso\(base\),to:toLocalIso\(rangeEnd\)\}\)/);assert.match(production,/Math\.max\(dayCount,186\)/)});

test("production workspace ignores stale period responses",()=>{assert.match(production,/loadSequence=useRef\(0\)/);assert.match(production,/new AbortController\(\)/);assert.match(production,/sequence!==loadSequence\.current/);assert.match(production,/controller\.abort\(\)/)});

test("month counters distinguish years and follow the selected period",()=>{assert.match(production,/start\.getMonth\(\)===m\.getMonth\(\)&&start\.getFullYear\(\)===m\.getFullYear\(\)/);assert.match(production,/new Date\(base\.getFullYear\(\),base\.getMonth\(\)\+i,1\)/);assert.match(production,/m\.getMonth\(\)===base\.getMonth\(\)&&m\.getFullYear\(\)===base\.getFullYear\(\)/);assert.match(production,/aria-current=\{active\?"date":undefined\}/)});
