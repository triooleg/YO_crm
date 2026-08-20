import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../components/settings-workspace.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("Meta settings use a Facebook popup and page picker as the primary flow", () => {
  assert.match(source, /meta\/oauth\/start/);
  assert.match(source, /window\.open/);
  assert.match(source, /meta\/oauth\/pages/);
  assert.match(source, /meta\/oauth\/connect/);
  assert.match(source, /JSON\.stringify\(\{flowId:metaFlowId,pageId\}\)/);
  assert.match(i18n, /Продолжить с Facebook/);
  assert.match(i18n, /Выберите страницу Facebook/);
});

test("manual Meta credentials remain in an explicit advanced section", () => {
  assert.match(source, /<details[^>]*className="settings-meta-advanced"/);
  assert.match(source, /settingsUi\.metaAdvanced/);
});
