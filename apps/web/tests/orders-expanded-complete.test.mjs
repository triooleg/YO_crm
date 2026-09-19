import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dashboard = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const legacyWorkspace = readFileSync(new URL("../components/orders-workspace.tsx", import.meta.url), "utf8");
const expandedStart = dashboard.indexOf("function ExpandedOrder");
const expandedEnd = dashboard.indexOf("function QuickPayment", expandedStart);
const expanded = expandedStart >= 0 && expandedEnd > expandedStart
  ? dashboard.slice(expandedStart, expandedEnd)
  : "";
const cellStart = dashboard.indexOf("function OrderCell");
const cellEnd = dashboard.indexOf("function ExpandedOrder", cellStart);
const orderCell = cellStart >= 0 && cellEnd > cellStart
  ? dashboard.slice(cellStart, cellEnd)
  : "";

test("OrdersDashboard uses one inline expansion path and never opens the former full card", () => {
  assert.doesNotMatch(dashboard, /OrderWorkspaceCard/);
  assert.doesNotMatch(dashboard, /workspaceId|setWorkspaceId/);
  assert.doesNotMatch(legacyWorkspace, /workspaceId|setWorkspaceId/);
  assert.match(dashboard, /const \[expandedId, setExpandedId\] = useState<string>\(\)/);
  assert.match(dashboard, /onExpand=\{\(\) => setExpandedId/);
  assert.match(orderCell, /orders-order-number[^>]*onClick=\{onExpand\}[^>]*>\{order\.number\}/);
  assert.match(orderCell, /orders-menu-button[^>]*onClick=\{onExpand\}/);
  assert.match(dashboard, /expandedId === order\.id && <tr className="orders-expanded-row"/);
});

test("expanded order preserves all four statuses with only sales and production editable", () => {
  for (const field of ["salesStatus", "productionStatus", "paymentStatus", "shippingStatus"]) {
    assert.match(expanded, new RegExp(`order\\.${field}`), `${field} must remain visible in the expanded row`);
  }
  assert.match(expanded, /<CrmNativeSelect[^>]*value=\{order\.salesStatus\}[^>]*onChange=\{[^}]*onStatus\("salesStatus",/);
  assert.match(expanded, /<CrmNativeSelect[^>]*value=\{order\.productionStatus\}[^>]*onChange=\{[^}]*onStatus\("productionStatus",/);
  assert.match(expanded, /<CrmStatusBadge domain="payment" status=\{order\.paymentStatus\}/);
  assert.match(expanded, /<CrmStatusBadge domain="shipping" status=\{order\.shippingStatus\}/);
  assert.doesNotMatch(expanded, /onStatus\("(?:paymentStatus|shippingStatus)",/);
});

test("expanded order exposes every numbered measurement only for its owning real or legacy item", () => {
  assert.match(expanded, /order\.items\.length/);
  assert.match(expanded, /measurement:\s*ownedMeasurement\(order\.measurement, order\.athlete\)/);
  assert.match(expanded, /item\.measurement/);
  assert.match(expanded, /values=\{item\.measurement\.values\}/);
  assert.match(expanded, /aria-controls=\{measurementDetailsId\}/);
  assert.match(dashboard, /role="region" aria-label=\{ui\.allMeasurements\}/);
  assert.match(dashboard, /orders-expanded-measurements/);
  assert.match(dashboard, /Array\.from\(\{\s*length:\s*17\s*\}/);
  assert.match(dashboard, /values\?\.\[`m\$\{number\}`\]/);
});

test("expanded order retains payment history, payment action, and invoice documents", () => {
  assert.match(expanded, /order\.depositRequiredMinor/);
  assert.match(expanded, /onPayment/);
  assert.match(expanded, /order\.payments\.map/);
  for (const field of ["amountMinor", "currency", "method", "receivedAt", "reference", "notes"]) {
    assert.match(expanded, new RegExp(`payment\\.${field}`), `payment ${field} must remain visible`);
  }
  assert.match(expanded, /order\.invoices(?:\?\.)?\.map/);
  assert.match(expanded, /invoice\.number/, "invoice number must remain visible");
  assert.match(expanded, /\/api\/finance\/invoices\/\$\{invoice\.id\}\/document/);
  assert.match(expanded, /download=1/);
});

test("status updates are serialized and refresh canonical order activity", () => {
  assert.match(dashboard, /statusRequests\.current\.has\(order\.id\)/);
  assert.match(dashboard, /statusRequests\.current\.add\(order\.id\)/);
  assert.match(dashboard, /await request\(`\/orders\/\$\{order\.id\}\/statuses`/);
  assert.match(dashboard, /await load\(\)/);
  assert.match(expanded, /disabled=\{statusPending\}/);
});

test("expanded order retains delivery, complete contact context, and activity history", () => {
  for (const field of ["displayName", "phone", "email", "source", "language", "country", "city", "address", "postalCode"]) {
    assert.match(expanded, new RegExp(`order\\.client\\.${field}`), `client ${field} must remain visible`);
  }
  for (const field of ["carrier", "trackingNumber", "costMinor"]) {
    assert.match(expanded, new RegExp(`order\\.shipment\\?\\.${field}`), `shipment ${field} must remain visible`);
  }
  assert.match(expanded, /visibleActivities\.map/);
  assert.match(expanded, /order\.activities\.slice\(0, 5\)/);
  for (const field of ["summary", "createdAt"]) {
    assert.match(expanded, new RegExp(`activity\\.${field}`), `activity ${field} must remain visible`);
  }
});
