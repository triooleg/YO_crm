import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settings = await readFile(new URL("../components/settings-workspace.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("настройки производства сначала показывают результат проверки и только затем разрешают коррекцию", () => {
  assert.match(settings, /correctWebsiteSales\(true\)/);
  assert.match(settings, /correctWebsiteSales\(false\)/);
  assert.match(settings, /disabled=\{correcting\|\|!correctionChecked\|\|correction\.matched===0\}/);
  assert.match(settings, /setCorrectionConfirmOpen\(true\)/);
  assert.match(settings, /<Modal opened=\{correctionConfirmOpen\}/);
  assert.match(settings, /\/api\/orders\/maintenance\/website-sales/);
  assert.match(i18n, /websiteSalesCorrectionTitle:\s*"Коррекция продаж с сайта"/);
});
