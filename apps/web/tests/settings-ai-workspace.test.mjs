import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const source = (
  await readFile(
    new URL("../components/settings-workspace.tsx", import.meta.url),
    "utf8",
  )
).replace(/\s+/g, "");
const communicationsCss = await readFile(
  new URL("../app/communications-template-menu.css", import.meta.url),
  "utf8",
);
test("AI настройки находятся в самостоятельной вкладке", () => {
  assert.match(source, /role="tablist"/);
  assert.match(source, /settingsUi\.aiTab/);
  assert.match(source, /settings-ai-panel/);
});
test("AI нельзя включить без согласия на передачу контекста", () => {
  assert.match(source, /allowClientContext/);
  assert.match(source, /enabled&&!consent/);
  assert.match(source, /settingsUi\.aiRequiredConsent/);
});
test("AI настройки имеют доступные состояния загрузки и сохранения", () => {
  assert.match(source, /aria-busy/);
  assert.match(source, /role="alert"/);
  assert.match(source, /role="status"/);
  assert.match(source, /disabled=\{saving\}/);
});
test("AI модель выбирается только из поддерживаемого списка", () => {
  assert.match(source, /constAI_MODEL_OPTIONS=\["gpt-4\.1-mini","gpt-4\.1","gpt-5-mini"\]asconst/);
  assert.match(source, /<selectname="model"defaultValue=\{data\.model\}required>/);
  assert.match(source, /AI_MODEL_OPTIONS\.map/);
  assert.doesNotMatch(source, /<inputname="model"/);
});
test("AI токен можно безопасно сохранить, заменить и удалить", () => {
  assert.match(source, /name="apiKey"/);
  assert.match(source, /type="password"/);
  assert.match(source, /autoComplete="new-password"/);
  assert.match(source, /settingsUi\.aiToken/);
  assert.match(source, /settingsUi\.aiDeleteToken/);
  assert.match(source, /removeApiKey:true/);
  assert.doesNotMatch(source, /value=\{data\.apiKey\}/);
});
test("channel settings show Meta, Chatwoot and email without reading secrets", () => {
  assert.match(source, /communications/);
  assert.match(source, /\/communications\/integrations/);
  assert.match(source, /accessToken/);
  assert.match(source, /password/);
  assert.match(source, /type="password"/);
  assert.match(source, /chatwoot/);
  assert.match(source, /email/);
  assert.match(source, /submitMeta/);
  assert.match(source, /metaWebhook/);
  assert.match(source, /webhookSecret/);
  assert.doesNotMatch(source, /value=\{data\.meta\.(appSecret|verifyToken|pageAccessToken|whatsappAccessToken)\}/);
});
test("channel enabled checkboxes stay compact and keep their accessible labels", () => {
  assert.equal(
    (source.match(/className="settings-channel-toggle"/g) || []).length,
    3,
  );
  assert.match(
    communicationsCss,
    /settings-channel-toggle input\[type="checkbox"\]\{[^}]*width:18px[^}]*height:18px[^}]*min-height:0[^}]*padding:0/,
  );
  assert.match(
    communicationsCss,
    /settings-channel-toggle\{[^}]*display:flex[^}]*align-items:center/,
  );
});
test("channel settings render readable headings and a common visible error", () => {
  assert.match(source, /settingsUi\.chatwootTitle\}\{"\\u00b7"\}/);
  assert.match(source, /settingsUi\.emailTitle\}\{"\\u00b7"\}/);
  assert.doesNotMatch(source, /Chatwoot В·|E-mail В·/);
  const loaded = source.slice(
    source.indexOf('return(<sectionid="settings-communications-panel"'),
  );
  assert.match(loaded, /role="alert"/);
  assert.ok(
    loaded.indexOf('role="alert"') < loaded.indexOf('submit("chatwoot"'),
  );
});
test("success message is shown only inside the saved channel form", () => {
  assert.match(source, /useState<"meta"\|"chatwoot"\|"email"\|null>/);
  assert.match(source, /saved==="meta"/);
  assert.match(source, /saved==="chatwoot"/);
  assert.match(source, /saved==="email"/);
});
