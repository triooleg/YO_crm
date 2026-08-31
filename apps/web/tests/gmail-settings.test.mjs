import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Gmail settings expose accessible save and verification actions", async () => {
  const source = await readFile(new URL("../components/settings-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /aria-describedby="email-app-password-hint"/);
  assert.match(source, /id="email-app-password-hint"/);
  assert.match(source, /settings-actions/);
  assert.match(source, /emailSaveBeforeVerify/);
  assert.match(source, /disabled=\{saving\|\|!data\.email\.passwordConfigured\}/);
});

test("e-mail conversations use the same real send action as connected chats", async () => {
  const source = await readFile(new URL("../components/communications-workspace.tsx", import.meta.url), "utf8");
  assert.match(source, /"CHATWOOT",\s*"EMAIL"[\s\S]{0,80}includes\(activeChannel\)/);
  assert.match(source, /safeAttachmentUrl/);
  assert.match(source, /\/api\\\/communications\\\/files/);
});
