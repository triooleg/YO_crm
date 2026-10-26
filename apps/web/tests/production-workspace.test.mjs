import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspace = await readFile(new URL("../components/production-workspace.tsx", import.meta.url), "utf8");
const planner = await readFile(new URL("../components/production-planner-view.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../components/crm-shell.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/production-workspace.css", import.meta.url), "utf8");
const view = await readFile(new URL("../lib/production-view.ts", import.meta.url), "utf8");

test("раздел Производство собирает реальный интерактивный планировщик", () => {
  assert.match(shell, /ProductionWorkspace/);
  for (const component of ["ProductionHeader", "ProductionKpis", "ProductionFiltersBar", "ProductionTimeline", "ProductionOrderDetails"]) assert.match(workspace, new RegExp(component));
  assert.match(workspace, /pointermove/);
  assert.match(planner, /timeline-payment-segment/);
  assert.match(planner, /timeline-production-segment/);
  assert.match(planner, /shipping-date-marker/);
  assert.match(styles, /\.production-board/);
});

test("периоды календаря меняют диапазон и ограничивают серверный запрос", () => {
  for (const mode of ["day", "week", "month", "twoMonths"]) assert.match(view, new RegExp(`${mode}: \\{ days:`));
  assert.match(workspace, /rangeEnd = productionAddDays\(base, range\.days - 1\)/);
  assert.match(workspace, /new URLSearchParams\(\{ from: productionIso\(base\), to: productionIso\(rangeEnd\) \}\)/);
  assert.match(workspace, /setBase\(productionAddDays\(base, -range\.shiftDays\)\)/);
  assert.match(workspace, /setBase\(productionAddDays\(base, range\.shiftDays\)\)/);
});

test("перемещение, изменение длительности, ограничения отправки и блокировка сохранены", () => {
  assert.match(workspace, /edge: "move" \| "left" \| "right"/);
  assert.match(workspace, /productionSlot\.locked/);
  assert.match(workspace, /dataset\.dragged/);
  assert.match(workspace, /shippingLimit/);
  assert.match(workspace, /productionSettings\.shippingLeadDays/);
  assert.match(workspace, /\/production-slot/);
  assert.match(planner, /className="resize left"/);
  assert.match(planner, /className="resize right"/);
  assert.match(planner, /onToggleLock/);
  assert.match(styles, /\.production-flow-bar\.locked/);
});

test("даты слота и плановой отправки сохраняются локально без перезагрузки очереди", () => {
  assert.match(workspace, /function saveDeadline/);
  assert.match(workspace, /`\/api\/orders\/\$\{order\.id\}\/deadline`/);
  assert.match(workspace, /const confirmed = saved\.requiredDeliveryAt \|\| requiredDeliveryAt/);
  assert.match(workspace, /deadlineSaveQueues\.current\.get\(order\.id\)/);
  assert.match(workspace, /deadlineSaveVersions\.current\.get\(order\.id\) === version/);
  assert.match(workspace, /confirmedDeadlines\.current\.get\(order\.id\)/);
  assert.match(planner, /onSaveDeadline/);
  assert.match(planner, /canEdit \? <label>/);
  assert.match(planner, /value=\{order\.requiredDeliveryAt \? productionIso\(order\.requiredDeliveryAt\) : ""\}/);
  const saveSlot = workspace.slice(workspace.indexOf("function saveSlot"), workspace.indexOf("async function deleteSlot"));
  assert.ok(saveSlot.length > 0);
  assert.doesNotMatch(saveSlot, /await load\(\)/);
});

test("календарь имеет компактные строки, закреплённую шапку и синхронную прокрутку", () => {
  assert.match(styles, /\.production-board-scroll\{[^}]*overflow:auto/);
  assert.match(styles, /\.production-calendar-header\{position:sticky;top:0/);
  assert.match(styles, /\.production-order-summary\{position:sticky;left:0/);
  assert.match(styles, /\.production-order-row\{min-height:46px/);
  assert.match(styles, /repeat\(var\(--timeline-days\),var\(--day-width\)\)/);
});

test("выбранный заказ открывает нижнюю панель с реальными данными и действиями", () => {
  assert.match(planner, /production-order-details/);
  assert.match(planner, /production-details-identity/);
  assert.match(planner, /production-lifecycle/);
  assert.match(planner, /production-details-dates/);
  assert.match(planner, /production-details-notes/);
  assert.match(planner, /production-details-actions/);
  assert.match(workspace, /onOpenOrder\(selectedOrder\.id\)/);
  assert.match(shell, /onOpenOrder=\{orderId=>void navigate\("orders",\{orderId\}\)\}/);
  assert.match(workspace, /production-board-shell/);
  assert.match(styles, /\.production-board-shell\{[^}]*position:relative[^}]*flex:1/);
  assert.match(styles, /\.production-board\{[^}]*height:100%/);
  assert.match(styles, /\.production-order-details\{[^}]*position:absolute[^}]*bottom:/);
  assert.match(styles, /\.production-board-shell\.has-selection \.production-board-canvas:after\{content:"";display:block;height:154px\}/);
  assert.match(styles, /@media\(max-width:1200px\)[\s\S]*\.production-board-shell\.has-selection \.production-board-canvas:after\{height:min\(calc\(70dvh \+ 48px\),608px\)\}/);
});

test("производственный график можно упорядочить по ближайшей дате отправки", () => {
  assert.match(workspace, /sortProductionOrdersByShippingProximity/);
  assert.match(workspace, /sortMode/);
  assert.match(planner, /productionUi\.sortShippingProximity/);
});

test("при наведении слот показывает краткие сроки выполнения", () => {
  assert.match(planner, /HoverCard/);
  assert.match(planner, /production-slot-preview/);
  assert.match(planner, /productionUi\.totalDuration/);
  assert.match(planner, /productionUi\.remainingProduction/);
});

test("уже отправленный заказ показывается одной серой полосой на весь слот", () => {
  assert.match(planner, /productionOrderIsShipped/);
  assert.match(planner, /timeline-shipped-segment/);
  assert.match(planner, /productionUi\.shippingShipped/);
  assert.match(styles, /\.production-flow-bar\.is-sent/);
});

test("удаление касается только выбранного слота и требует подтверждения", () => {
  assert.match(workspace, /productionUi\.deleteSlotTitle/);
  assert.match(workspace, /method: "DELETE"/);
  assert.match(workspace, /`\/api\/orders\/\$\{selectedOrder\.id\}\/production-slot`/);
  assert.match(workspace, /expectedUpdatedAt: selectedOrder\.productionSlot\.updatedAt/);
  assert.match(workspace, /productionStatus: "NOT_SCHEDULED"/);
  assert.match(workspace, /<Modal[\s\S]*productionUi\.deleteSlotConfirm/);
});

test("проекция загружается безопасно и устаревшие ответы игнорируются", () => {
  assert.match(workspace, /\/api\/orders\/production\?\$\{params\.toString\(\)\}/);
  assert.match(workspace, /loadSequence = useRef\(0\)/);
  assert.match(workspace, /new AbortController\(\)/);
  assert.match(workspace, /sequence !== loadSequence\.current/);
  assert.match(workspace, /controller\.abort\(\)/);
});

test("предпросмотр изображения использует сохранённую настройку ширины", () => {
  assert.match(workspace, /orders-image-preview-width-v1/);
  assert.match(workspace, /previewWidth/);
  assert.match(planner, /onMouseMove/);
  assert.match(styles, /\.production-image-preview/);
});
