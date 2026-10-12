import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/orders-dashboard.css", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/layout.tsx", import.meta.url), "utf8");
const orderPanel = readFileSync(new URL("../components/order-panel.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const api = readFileSync(new URL("../../api/src/orders/orders.service.ts", import.meta.url), "utf8");
const ui = source + dashboard + i18n;

test("Orders redesign exposes the complete operational overview", () => {
  for (const label of ["Все заказы", "Нужна предоплата", "Срок ≤ 7 дней", "Просрочены", "Готовы к отправке", "Завершенные"]) {
    assert.match(ui, new RegExp(label));
  }
  for (const column of ["№ / Клиент", "Модель / Спорт", "Кол-во", "Производство", "Создан"]) {
    assert.match(ui, new RegExp(column));
  }
  assert.doesNotMatch(dashboard, /source:\s*"Источник"/);
});

test("Orders redesign keeps real controls and deterministic guidance", () => {
  for (const token of ["orders-filter-trigger", "orders-filter-chips", "orders-export", "orders-pagination", "refreshOrder", "orderProblems", "OrderChannelIcon"]) {
    assert.match(dashboard, new RegExp(token));
  }
  assert.match(dashboard, /orders-tab-designs/);
  assert.match(ui, /Финансы по заказу/);
  assert.match(ui, /Пожелания клиента/);
  assert.match(ui, /Заметки менеджера/);
  assert.match(ui, /Открыть заказ/);
  assert.match(dashboard, /!loading && !error && !shown\.length/);
  assert.match(dashboard, /onClick=\{\(\) => void load\(\)\}/);
});

test("быстрые продажи не предлагают передачу в производство", () => {
  assert.match(dashboard, /NON_PRODUCTION_ORDER_TYPES = new Set\(\["READY_MODEL", "ACCESSORY", "WEBSITE_SALE", "STOCK_SALE"\]\)/);
  assert.match(dashboard, /!NON_PRODUCTION_ORDER_TYPES\.has\(order\.type\)/);
});

test("Orders list projection supplies the redesigned table without per-row requests", () => {
  for (const field of ["discipline: true", "deliveryMinor: true", "discountMinor: true", "phone: true", "email: true"]) {
    assert.match(api, new RegExp(field));
  }
  assert.match(api, /shipment: true/);
});

test("Orders redesign has isolated responsive table and expanded layout", () => {
  assert.match(css, /\.orders-kpi-grid/);
  assert.match(css, /\.orders-command-bar/);
  assert.match(css, /\.orders-order-overview/);
  assert.match(css, /\.orders-table-scroll/);
  assert.match(css, /overflow-x:auto/);
});

test("Orders summary keeps headers aligned and exposes the canonical order number", () => {
  assert.match(dashboard, /<colgroup><col className="orders-controls"\s*\/?>\{visibleColumns\.map\(\(id\) => <col key=\{id\} className=\{`orders-col orders-col-\$\{id\}`\}\s*\/?>\)\}<\/colgroup>/);
  assert.match(css, /\.orders-dashboard-table\{[^}]*table-layout:fixed/);
  assert.match(css, /\.orders-dashboard-table thead\{[^}]*display:table-header-group!important/);
  assert.match(css, /\.orders-dashboard-table tbody\{[^}]*display:table-row-group!important/);
  assert.match(css, /tbody>tr:not\(\.orders-expanded-row\)\{display:table-row!important;grid-template-columns:none!important/);
  assert.match(dashboard, /orders-order-number[^>]*onClick=\{onExpand\}[^>]*>\{order\.number\}/);
  assert.match(dashboard, /orders-menu-button[^>]*onClick=\{onExpand\}/);
  assert.doesNotMatch(dashboard, /workspaceId|setWorkspaceId|OrderWorkspaceCard/);
  assert.doesNotMatch(dashboard, /orderListNumber\(/);
});

test("Orders summary retains editable deadlines, prefixed country flags, and readable type", () => {
  assert.match(dashboard, /orders-deadline-button[^\n]*type="date"[^\n]*aria-label=\{ui\.changeDeadline\}/);
  assert.match(dashboard, /showPicker\(\)/);
  assert.match(dashboard, /prefixedCode = normalized\.toUpperCase\(\)\.match\(/);
  assert.match(dashboard, /function countryLabel\(country\?: string\)/);
  assert.match(dashboard, /function CountryFlag/);
  assert.match(dashboard, /fi-\$\{code\.toLowerCase\(\)\}/);
  assert.match(layout, /flag-icons\/css\/flag-icons\.min\.css/);
  assert.match(css, /orders-deadline-button:focus-within/);
  const pixelSizes = [...css.matchAll(/font-size:(\d+)px/g)].map((match) => Number(match[1]));
  assert.ok(pixelSizes.length > 0);
  assert.ok(Math.min(...pixelSizes) >= 9, `minimum Orders font must be 9px, got ${Math.min(...pixelSizes)}px`);
});

test("Orders summary omits the redundant problems column", () => {
  const defaultColumns=dashboard.match(/const DEFAULT_COLUMNS[^=]*=\s*\[([^\]]+)\]/)?.[1]||"";
  assert.match(defaultColumns,/"menu"/);
  assert.doesNotMatch(defaultColumns,/"problems"/);
  assert.doesNotMatch(dashboard, /id === "problems"/);
  assert.doesNotMatch(i18n, /problems: "Проблемы"/);
});

test("Orders sport remains visible in the combined model column and editable through the full order form", () => {
  assert.match(dashboard, /orders-model-sport-cell/);
  assert.match(dashboard, /discipline\(order\.discipline\)\.label/);
  assert.match(dashboard, /onClick=\{onEdit\}/);
});

test("история заказа сначала показывает пять последних записей",()=>{
  assert.match(dashboard,/historyItems\.slice\(0,5\)/);
  assert.match(dashboard,/showOlderHistory/);
  assert.match(dashboard,/hideOlderHistory/);
});

test("New order button opens the existing order form through client selection", () => {
  assert.match(dashboard, /import \{ OrderPanel \} from "\.\/order-panel"/);
  assert.match(dashboard, /onClick=\{\(\) => openNewOrder\(\)\}/);
  assert.match(dashboard, /<OrderClientPicker/);
  assert.match(dashboard, /<OrderPanel client=\{newOrderClient\}/);
  assert.match(dashboard, /\?search=\$\{encodeURIComponent\(query\)\}/);
  assert.match(dashboard, /<Modal opened/);
  assert.match(orderPanel, /<Drawer opened/);
  assert.match(orderPanel, /closeOnEscape=\{!saving\} closeOnClickOutside=\{!saving\} trapFocus returnFocus/);
  assert.match(orderPanel, /aria-label=\{orderFormUi\.close\}/);
  assert.doesNotMatch(dashboard, /orders-new-order" onClick=\{\(\) => onNavigate\("clients"\)\}/);
});
