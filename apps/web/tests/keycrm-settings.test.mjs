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

test("предложения объединения отделены от ошибок и запускают только ручное объединение", () => {
  assert.match(workspace, /CLIENT_MERGE_SUGGESTION/);
  assert.match(workspace, /clientMergeSuggestions/);
  assert.match(workspace, /\/api\/clients\/\$\{candidate\.clientId\}\/merge/);
  assert.match(workspace, /sourceClientId:details\.importedClientId/);
  assert.match(i18n, /mergeSuggestions:\s*"Предложения объединения"/);
  assert.match(i18n, /mergeClient:\s*"Объединить карточки"/);
  assert.match(workspace, /<Modal[\s\S]*pendingMerge/);
  assert.match(workspace, /aria-label=\{mergeAccessibleName/);
  assert.match(workspace, /keycrm-merge-suggestions/);
});

test("неудачный APPLY можно откатить только через явное Mantine-подтверждение", () => {
  assert.match(workspace, /current\.mode==="APPLY"/);
  assert.match(workspace, /current\.status==="PARTIAL"\|\|current\.status==="FAILED"/);
  assert.match(workspace, /!current\.rolledBackAt/);
  assert.match(workspace, /current\.rollbackEligible\?/);
  assert.match(workspace, /current\.rollbackBlockedReason/);
  assert.doesNotMatch(workspace, /window\.confirm\(ui\.rollbackConfirm\)/);
  assert.match(workspace, /<Modal[\s\S]*rollbackOpen/);
  assert.match(workspace, /ui\.rollbackRunId/);
  assert.match(workspace, /ui\.rollbackConsequences/);
  assert.match(workspace, /\/api\/keycrm\/sync-runs\/\$\{current\.id\}\/rollback/);
  assert.match(i18n, /rollback:\s*"Откатить неудачный перенос"/);
});

test("пустые необязательные UUID KeyCRM не отправляются как невалидные строки", () => {
  assert.match(workspace, /productionStartFieldUuid=String\(form\.get\("productionStartFieldUuid"\)\|\|""\)\.trim\(\)/);
  assert.match(workspace, /\.\.\.\(productionStartFieldUuid\?\{productionStartFieldUuid\}:\{\}\)/);
  assert.match(workspace, /\.\.\.\(expectedDeliveryFieldUuid\?\{expectedDeliveryFieldUuid\}:\{\}\)/);
});

test("курс доступен для чтения всем финансовым ролям, а менять источник могут только OWNER и ADMIN", () => {
  assert.match(workspace, /<FinanceSettings canManageExchangeRates=\{role==="OWNER"\|\|role==="ADMIN"\}\/>/);
  assert.match(workspace, /function ExchangeRateSettings\(\{canManage\}/);
  assert.match(workspace, /disabled=\{!data\|\|busy\|\|!canManage\}/);
  assert.match(workspace, /\{canManage&&<div className="settings-actions">/);
});
