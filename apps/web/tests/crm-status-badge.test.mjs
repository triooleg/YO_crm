import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [statusBadge, ordersDashboard, orderTabs] = await Promise.all([
  readFile(new URL("../components/crm/status-badge.tsx", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8"),
  readFile(new URL("../components/orders/order-expanded-tabs.tsx", import.meta.url), "utf8"),
]);
const statusSelect=await readFile(new URL("../components/crm/sales-status-select.tsx",import.meta.url),"utf8");

test("статусы заказов отображаются единым CRM-компонентом на Mantine Badge", () => {
  assert.match(statusBadge, /import \{ Badge \} from "@mantine\/core"/);
  assert.match(statusBadge, /export function CrmStatusBadge/);
  assert.match(statusBadge, /export function crmStatusPresentation/);
  assert.match(statusBadge, /tone \? orderLabel\(domain,status\) : crmStatusUi\.unknown/);
  assert.match(statusBadge, /crmStatusUi\.unknown/);
  assert.match(statusBadge, /const STATUS_TONES/);
  assert.match(statusBadge, /payment:/);
  assert.match(statusBadge, /shipping:/);
  assert.match(statusBadge, /production:/);
  assert.match(statusBadge, /sales:/);

  const ordersUi = ordersDashboard + orderTabs;
  assert.match(ordersUi, /<CrmStatusBadge domain="payment" status=\{order\.paymentStatus\}/);
  assert.match(ordersUi, /<CrmStatusBadge domain="shipping" status=\{order\.shippingStatus\}/);
  assert.match(ordersUi, /<CrmStatusBadge domain="production" status=\{(?:item|instance)\.productionStatus\}/);
  assert.match(ordersDashboard, /crmStatusPresentation\("sales",\s*order\.salesStatus\)\.color/);
  assert.match(statusSelect, /crmStatusPresentation\("sales",value\)/);
  assert.match(statusSelect, /renderOption.*CrmStatusBadge/);
  assert.doesNotMatch(ordersDashboard, /function statusTone/);
  assert.doesNotMatch(ordersDashboard, /<span className=\{`orders-status orders-status--\$\{statusTone\(/);
});
