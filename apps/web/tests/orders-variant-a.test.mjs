import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../app/orders-dashboard.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const production = readFileSync(new URL("../components/production-workspace.tsx", import.meta.url), "utf8");
const finance = readFileSync(new URL("../components/finance-workspace.tsx", import.meta.url), "utf8");
const shipping = readFileSync(new URL("../components/shipping-workspace.tsx", import.meta.url), "utf8");

const expandedStart = dashboard.indexOf("function ExpandedOrder");
const expandedEnd = dashboard.indexOf("function QuickPayment", expandedStart);
const expanded = dashboard.slice(expandedStart, expandedEnd);

test("variant A keeps one dense order workspace with contextual navigation", () => {
  for (const className of [
    "orders-expanded-quick-nav",
    "orders-expanded-meta",
    "orders-expanded-operations",
    "orders-expanded-payments",
    "orders-expanded-finance",
    "orders-expanded-history",
  ]) assert.match(expanded, new RegExp(className));

  for (const callback of ["onConversation", "onClient", "onProduction", "onFinance", "onShipping"]) {
    assert.match(expanded, new RegExp(callback));
  }
  assert.match(dashboard, /onNavigate\("production", \{ orderId: order\.id \}\)/);
  assert.match(dashboard, /onNavigate\("finance", \{ orderId: order\.id \}\)/);
  assert.match(dashboard, /onNavigate\("shipping", \{ orderId: order\.id \}\)/);
  assert.match(dashboard, /onFinance=\{canOpenOrderFinance\(role\)/);
});

test("contextual links resolve the exact order in every destination and fail visibly", () => {
  for (const [source, selectedPattern, errorPattern, clearPattern] of [
    [production, /setSelected\(order\.id\)/, /productionUi\.contextOrderUnavailable/, /clearProductionContextAction\(\)/],
    [finance, /setFocusedOrderId\(order\.id\)/, /financeUi\.contextOrderUnavailable/, /clearFinanceContextAction\(\)/],
    [shipping, /setSelected\(order\)/, /shippingUi\.contextOrderUnavailable/, /clearShippingContextAction\(\)/],
  ]) {
    assert.match(source, /resolveOrderContext\(/);
    assert.match(source, selectedPattern);
    assert.match(source, errorPattern);
    assert.match(source, clearPattern);
  }
  assert.match(production, /production\?orderId=/);
  assert.match(production, /setSearch\(order\.number\)/);
  assert.match(finance, /finance-order\$\{focusedOrderId===order\.id\?" is-context":""\}/);
  assert.match(shipping, /shipping-row\$\{selected\?\.id===o\.id\?" is-context":""\}/);
});

test("variant A preserves semantic status dimensions and real production slot data", () => {
  for (const dimension of ["sales", "payment", "production", "shipping"]) {
    assert.match(expanded, new RegExp(`orders-expanded-status--${dimension}`));
  }
  assert.match(workspace, /productionSlot\?:\{/);
  assert.match(expanded, /order\.productionSlot/);
  assert.doesNotMatch(expanded, /responsibleManager|fake|mock/i);
});

test("each costume owns its immediately adjacent measurement row", () => {
  assert.match(expanded, /orders-expanded-item-block/);
  assert.match(expanded, /orders-expanded-item-row/);
  assert.match(expanded, /measurementId === item\.id && item\.measurement && <ExpandedMeasurementGrid/);
  assert.match(expanded, /measurement=\{item\.measurement\}/);
  assert.match(dashboard, /measurementFieldLabels/);
  assert.match(dashboard, /Array\.from\(\{ length: 17 \}/);
  assert.match(expanded, /ownedMeasurement\(item\.measurement, athlete\)/);
  assert.match(dashboard, /measurement\.athleteId === athlete\.id/);
  assert.match(dashboard, /ownedMeasurement\(order\.measurement, item\.athlete \|\| order\.athlete\)/);
  assert.match(expanded, /measurement: ownedMeasurement\(order\.measurement, order\.athlete\)/);
  assert.match(dashboard, /function hasMeasurements\(order: Order\) \{ return orderMeasurementState\(order\)\.complete; \}/);
  assert.match(dashboard, /orderMeasurementState\(order\)\.problem === "dimensions"/);
  assert.match(dashboard, /orderMeasurementState\(order\)\.nextAction === "dimensions"/);
});

test("variant A separates transactions from totals and avoids duplicated linked sections", () => {
  assert.match(expanded, /orders-expanded-payments/);
  assert.match(expanded, /order\.payments\.map/);
  assert.match(expanded, /orders-expanded-finance/);
  assert.match(expanded, /MoneyLine/);
  assert.doesNotMatch(expanded, /orders-expanded-related/);
  assert.match(expanded, /historyExpanded \? order\.activities : order\.activities\.slice\(0, 5\)/);
  assert.match(expanded, /setHistoryExpanded/);
  assert.match(expanded, /<CrmButton tone="secondary" className="orders-history-toggle"/);
});

test("variant A has responsive compact styling with semantic status accents", () => {
  for (const selector of [
    ".orders-expanded-layout-a",
    ".orders-expanded-quick-nav",
    ".orders-expanded-meta",
    ".orders-expanded-item-block",
    ".orders-expanded-measurements",
  ]) assert.match(styles, new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(styles, /orders-expanded-status--sales/);
  assert.match(styles, /orders-expanded-status--payment/);
  assert.match(styles, /orders-expanded-status--production/);
  assert.match(styles, /orders-expanded-status--shipping/);
  assert.match(styles, /@media\s*\(max-width:\s*900px\)/);
  assert.match(styles, /orders-expanded-command-row\{grid-column:1\/-1;display:grid;grid-template-columns:minmax\(640px,1fr\) auto/);
  assert.match(styles, /orders-expanded-command-row \.orders-expanded-statuses\{grid-column:auto\}/);
  assert.doesNotMatch(styles, /@media \(max-width:1250px\)\{\.orders-expanded-command-row\{grid-template-columns:1fr/);
  assert.match(styles, /width:calc\(100vw - 24px\)/);
  assert.match(expanded, /<CrmButton tone="secondary"/);
  assert.match(styles, /orders-expanded-measurements span small\{white-space:normal;overflow-wrap:anywhere/);
  assert.doesNotMatch(styles, /orders-expanded-measurements span small\{[^}]*text-overflow/);
  assert.match(styles, /orders-item-payment>small,.orders-item-payment>strong\{display:block\}/);
  assert.match(styles, /orders-expanded-items \.orders-expanded-item-row\{grid-template-columns:22px 44px minmax\(0,1fr\);align-items:start;min-width:0/);
  assert.match(styles, /orders-expanded-item-block \.orders-expanded-measurements\{min-width:0;grid-template-columns:repeat\(2,minmax\(0,1fr\)\);padding:8px\}/);
  assert.doesNotMatch(styles, /@media \(max-width:900px\)[^\n]*min-width:780px/);
});
