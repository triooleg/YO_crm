import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
const source=await readFile(new URL("../components/settings-workspace.tsx",import.meta.url),"utf8");
const communicationsCss=await readFile(new URL("../app/communications-template-menu.css",import.meta.url),"utf8");
test("AI настройки находятся в самостоятельной вкладке",()=>{assert.match(source,/role="tablist"/);assert.match(source,/settingsUi\.aiTab/);assert.match(source,/settings-ai-panel/)});
test("AI нельзя включить без согласия на передачу контекста",()=>{assert.match(source,/allowClientContext/);assert.match(source,/enabled&&!consent/);assert.match(source,/settingsUi\.aiRequiredConsent/)});
test("AI настройки имеют доступные состояния загрузки и сохранения",()=>{assert.match(source,/aria-busy/);assert.match(source,/role="alert"/);assert.match(source,/role="status"/);assert.match(source,/disabled=\{saving\}/)});
test("channel settings show Chatwoot and email without reading secrets",()=>{assert.match(source,/communications/);assert.match(source,/\/communications\/integrations/);assert.match(source,/accessToken/);assert.match(source,/password/);assert.match(source,/type="password"/);assert.match(source,/chatwoot/);assert.match(source,/email/)});
test("channel enabled checkboxes stay compact and keep their accessible labels",()=>{assert.equal((source.match(/className="settings-channel-toggle"/g)||[]).length,2);assert.match(communicationsCss,/settings-channel-toggle input\[type="checkbox"\]\{[^}]*width:18px[^}]*height:18px[^}]*min-height:0[^}]*padding:0/);assert.match(communicationsCss,/settings-channel-toggle\{[^}]*display:flex[^}]*align-items:center/)});
test("channel settings render readable headings and a common visible error",()=>{
  assert.match(source,/Chatwoot \{"\\u00b7"\}/);
  assert.match(source,/E-mail \{"\\u00b7"\}/);
  assert.doesNotMatch(source,/Chatwoot В·|E-mail В·/);
  const loaded=source.slice(source.indexOf('return <section id="settings-communications-panel"'));
  assert.match(loaded,/role="alert"/);
  assert.ok(loaded.indexOf('role="alert"')<loaded.indexOf('submit("chatwoot"'));
});
