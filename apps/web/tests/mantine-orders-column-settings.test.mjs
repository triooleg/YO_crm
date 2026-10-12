import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../components/orders-dashboard.tsx", import.meta.url), "utf8");

test("настройка столбцов заказов использует доступное Mantine-окно и общие контролы", () => {
  assert.match(source, /<Modal opened=\{columnsOpen\}/);
  assert.match(source, /title=\{ui\.columns\}/);
  assert.match(source, /closeButtonProps=\{\{ "aria-label": ui\.close \}\}/);
  assert.match(source, /ref=\{columnsTrigger\}/);
  assert.match(source, /<CrmCheckbox[\s\S]*data-autofocus=\{index === 0 \|\| undefined\}/);
  assert.match(source, /<CrmActionIcon[\s\S]*aria-label=\{ui\.moveUp\}/);
  assert.match(source, /<CrmButton tone="secondary"[\s\S]*ui\.reset/);
  assert.doesNotMatch(source, /orders-column-settings-overlay/);
});

test("настройка столбцов сохраняет новый контракт и мигрирует вариант A", () => {
  assert.match(source, /const COLUMN_SETTINGS_KEY = "orders-dashboard-columns-v3"/);
  assert.match(source, /const LEGACY_COLUMN_SETTINGS_KEY = "orders-dashboard-columns-v2"/);
  assert.match(source, /migrateLegacyOrderColumnSettings/);
  assert.match(source, /localStorage\.setItem\(COLUMN_SETTINGS_KEY/);
  assert.match(source, /draggable/);
  assert.match(source, /onDrop=\{\(\) => dropColumn\(id\)\}/);
  assert.match(source, /persistColumns\(DEFAULT_COLUMNS, new Set\(\)\)/);
});
