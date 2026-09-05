import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settings = await readFile(new URL("../components/settings-workspace.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../components/crm-shell.tsx", import.meta.url), "utf8");
const inbox = await readFile(new URL("../components/communications-workspace.tsx", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/branding-settings.css", import.meta.url), "utf8").catch(() => "");

test("interface settings upload and preview a company logo with independent uses", () => {
  assert.match(settings, /function BrandingSettings/);
  assert.match(settings, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(settings, /useInHeader/);
  assert.match(settings, /useInMessages/);
  assert.match(settings, /\/api\/branding/);
  assert.match(settings, /yoleotard-branding-changed/);
  assert.match(styles, /branding-logo-preview/);
});

test("saved branding updates shell and outbound message avatars", () => {
  assert.match(shell, /useBranding/);
  assert.match(shell, /branding\.useInHeader/);
  assert.match(inbox, /businessLogoUrl/);
  assert.match(inbox, /communications-business-logo/);
});

test("custom logos keep their aspect ratio inside every fixed avatar slot", () => {
  assert.match(styles, /\.crm-custom-logo,.communications-business-logo\{[^}]*object-fit:contain/);
  assert.doesNotMatch(shell, /className="crm-brand"/);
  assert.match(shell, /className="crm-topbar-brand"/);
  assert.match(styles, /\.crm-topbar-brand>\.crm-custom-logo\{[^}]*flex:0 0 34px[^}]*max-width:34px/);
  assert.match(styles, /\.communications-business-logo\{[^}]*max-width:100%[^}]*max-height:100%/);
});

test("an invalid replacement clears the previously selected logo before validation", () => {
  const pick = settings.match(/function pick\(next\?:File\)\{(.+?)\}\r?\n  async function persist/s)?.[1] ?? "";
  const clearFile = pick.indexOf("setFile(undefined)");
  const clearPreview = pick.indexOf('setPreview("")');
  const typeValidation = pick.indexOf('includes(next.type)');
  const sizeValidation = pick.indexOf("next.size>3*1024*1024");
  assert.ok(clearFile >= 0 && clearFile < typeValidation);
  assert.ok(clearPreview >= 0 && clearPreview < typeValidation);
  assert.ok(clearFile < sizeValidation && clearPreview < sizeValidation);
});
