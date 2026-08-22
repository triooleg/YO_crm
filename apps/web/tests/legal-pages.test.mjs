import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";

test("public Meta legal routes use centralized Russian UI text", async () => {
  const [privacy, terms, deletion, i18n] = await Promise.all([
    readFile(new URL("../app/legal/privacy/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/legal/terms/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/legal/data-deletion/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8"),
  ]);
  for (const page of [privacy, terms, deletion]) assert.match(page, /legalUi/);
  assert.match(i18n, /Политика конфиденциальности/);
  assert.match(i18n, /Удаление данных/);
});

test("Meta app icon is a 1024 by 1024 PNG", async () => {
  const url = new URL("../public/meta/yoleotard-crm-app-icon-1024.png", import.meta.url);
  await stat(url);
  const png = await readFile(url);
  assert.equal(png.readUInt32BE(16), 1024);
  assert.equal(png.readUInt32BE(20), 1024);
});
