import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(new URL("../components/settings-workspace.tsx", import.meta.url), "utf8");
const i18n = readFileSync(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("в настройках есть отдельный управляемый импорт KeyCRM", () => {
  assert.match(workspace, /function KeycrmSettings/);
  assert.match(workspace, /\/api\/keycrm\/settings/);
  assert.match(workspace, /\/api\/keycrm\/test-connection/);
  assert.match(workspace, /\/api\/keycrm\/sync-runs/);
  assert.match(workspace, /dryRun/);
  assert.match(workspace, /currentPage/);
  assert.match(workspace, /issues/);
  assert.match(workspace, /previewForRange/);
});

test("весь новый пользовательский текст KeyCRM вынесен в русский словарь", () => {
  assert.match(i18n, /keycrm:\s*\{/);
  assert.match(i18n, /title:\s*"Синхронизация с KeyCRM"/);
  assert.match(i18n, /preview:\s*"Проверить без переноса"/);
  assert.match(i18n, /apply:\s*"Перенести и синхронизировать"/);
});
