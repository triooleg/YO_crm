import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const source=await readFile(new URL("../components/settings-workspace.tsx",import.meta.url),"utf8");
test("AI настройки находятся в самостоятельной вкладке",()=>{assert.match(source,/role="tablist"/);assert.match(source,/settingsUi\.aiTab/);assert.match(source,/settings-ai-panel/)});
test("AI нельзя включить без согласия на передачу контекста",()=>{assert.match(source,/allowClientContext/);assert.match(source,/enabled&&!consent/);assert.match(source,/settingsUi\.aiRequiredConsent/)});
test("AI настройки имеют доступные состояния загрузки и сохранения",()=>{assert.match(source,/aria-busy/);assert.match(source,/role="alert"/);assert.match(source,/role="status"/);assert.match(source,/disabled=\{saving\}/)});
