import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const dashboard = await readFile(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("selected orders expose a confirmed archive action", () => {
  assert.match(dashboard, /selectedIds\.size > 0[\s\S]*?ui\.archiveSelected/);
  assert.match(dashboard, /setArchiveOpen\(true\)/);
  assert.match(dashboard, /<Modal opened=\{archiveOpen\}/);
  assert.match(dashboard, /request\("\/orders\/archive", \{ method: "PATCH"/);
  assert.match(dashboard, /orderIds: \[\.\.\.selectedIds\]/);
  assert.match(i18n, /archiveSelected: "Удалить выбранные"/);
  assert.match(i18n, /archiveOrdersHint: "Заказы будут перемещены в архив/);
});

test("archive action is limited to owner and administrator", () => {
  assert.match(dashboard, /const canArchiveOrders = role === "OWNER" \|\| role === "ADMIN"/);
  assert.match(dashboard, /canArchiveOrders && <CrmButton/);
});
