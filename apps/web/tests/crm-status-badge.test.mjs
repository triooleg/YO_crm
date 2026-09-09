import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [statusBadge, ordersDashboard] = await Promise.all([
  readFile(new URL("../components/crm/status-badge.tsx", import.meta.url), "utf8").catch(() => ""),
  readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8"),
]);

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

  assert.match(ordersDashboard, /<CrmStatusBadge domain="payment" status=\{order\.paymentStatus\}/);
  assert.match(ordersDashboard, /<CrmStatusBadge domain="shipping" status=\{order\.shippingStatus\}/);
  assert.match(ordersDashboard, /<CrmStatusBadge domain="production" status=\{item\.productionStatus\}/);
  assert.match(ordersDashboard, /crmStatusPresentation\("sales",\s*order\.salesStatus\)\.tone/);
  assert.doesNotMatch(ordersDashboard, /function statusTone/);
  assert.doesNotMatch(ordersDashboard, /<span className=\{`orders-status orders-status--\$\{statusTone\(/);
});
