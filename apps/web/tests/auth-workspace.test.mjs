import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../components/crm-shell.tsx", import.meta.url), "utf8");
const settings = await readFile(new URL("../components/settings-workspace.tsx", import.meta.url), "utf8");
const locale = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const shellCss=await readFile(new URL("../app/crm-shell.css",import.meta.url),"utf8");

test("вся CRM закрыта единым экраном входа", () => {
  assert.match(shell, /\/api\/auth\/me/);
  assert.match(shell, /\/api\/auth\/login/);
  assert.match(shell, /auth===false/);
  assert.match(shell, /credentials:"include"/);
  assert.match(shell,/setInterval\(verifyAuth,60_000\)/);
  assert.match(shell,/addEventListener\("focus",focus\)/);
  assert.match(shell,/authSequence/);
  assert.match(shell,/sequence!==authSequence\.current/);
  assert.match(shell,/if\(!r\.ok\)throw new Error\(\);authSequence\.current\+\+;setAuth\(false\)/);
  assert.match(shell,/setSubmitting\(true\)/);
  assert.match(shell,/finally\{setSubmitting\(false\)\}/);
  assert.match(shell,/disabled=\{submitting\}/);
  assert.match(shell,/r\.status===401\|\|r\.status===403/);
  assert.match(shell,/if\(!r\.ok\)throw new Error\(\)/);
});

test("в настройках можно безопасно изменить логин и пароль", () => {
  assert.match(settings, /settingsUi\.accountTab/);
  assert.match(settings, /\/api\/auth\/account/);
  assert.match(settings, /name="currentPassword"/);
  assert.match(settings, /name="newPassword"/);
  assert.match(settings, /name="confirmPassword"/);
  assert.match(locale, /accountTab:\s*"Учётная запись"/);
  assert.match(locale,/export const authUi/);
  assert.match(settings,/currentEmail/);
  assert.match(settings,/newEmail/);
  assert.match(settings,/role==="OWNER"/);
  assert.match(settings,/className="settings-grid"/);
  assert.match(shellCss,/\.crm-logout\{[^}]*height:42px/);
  assert.match(shellCss,/@media\(max-width:720px\)[\s\S]*\.crm-logout\{[^}]*height:62px/);
});
