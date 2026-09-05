import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const app = await readFile(new URL("../src/app.module.ts", import.meta.url), "utf8");
const controller = await readFile(new URL("../src/branding/branding.controller.ts", import.meta.url), "utf8").catch(() => "");
const service = await readFile(new URL("../src/branding/branding.service.ts", import.meta.url), "utf8").catch(() => "");

test("branding settings are authenticated and only owner/admin may change them", () => {
  assert.match(app, /BrandingController/);
  assert.match(app, /BrandingService/);
  assert.match(controller, /@UseGuards\(SessionGuard, RolesGuard\)/);
  assert.match(controller, /@Get\(\)/);
  assert.match(controller, /@Put\(\)/);
  assert.match(controller, /@Roles\("OWNER", "ADMIN"\)/);
});

test("company logo uses persistent uploads, validates image bytes and audits changes", () => {
  assert.match(service, /uploadsRoot\(\)/);
  assert.match(service, /branding/);
  assert.match(service, /MAX_LOGO_BYTES/);
  assert.match(service, /sharp\(source\)\.metadata\(\)/);
  assert.match(service, /appSetting\.upsert/);
  assert.match(service, /entityType: "BrandingSetting"/);
  assert.doesNotMatch(service, /unlink\(/);
});

test("stored logos are served only by a bounded file name", () => {
  assert.match(controller, /@Get\("logo\/:name"\)/);
  assert.match(controller, /BRANDING_FILE_NAME\.test\(name\)/);
  assert.match(controller, /sendFile/);
});
