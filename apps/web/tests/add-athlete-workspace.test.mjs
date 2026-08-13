import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const workspace = (await readFile(
  new URL("../components/client-workspace.tsx", import.meta.url),
  "utf8",
)).replace(/\s+/g, "");
const locale = await readFile(
  new URL("../lib/i18n.ts", import.meta.url),
  "utf8",
);

test("форма отправляет только допустимый код дисциплины и пропускает пустое значение", () => {
  assert.match(workspace, /<selectname="discipline">/);
  assert.match(workspace, /RHYTHMIC_GYMNASTICS/);
  assert.match(workspace, /if\(discipline\)body\.discipline=discipline/);
  assert.doesNotMatch(workspace, /<inputname="discipline"/);
});

test("кнопка спортсменов открывает доступную форму и сохраняет через API клиента", () => {
  assert.match(workspace, /onAddAthlete=\{\(\)=>setAddingAthlete\(true\)\}/);
  assert.match(workspace, /role="dialog"/);
  assert.match(workspace, /aria-modal="true"/);
  assert.match(workspace, /`\/clients\/\$\{clientId\}\/athletes`/);
  assert.match(workspace, /disabled=\{saving\}/);
  assert.match(workspace, /returnFocusRef\.current\?\.focus\(\)/);
  assert.match(workspace, /buttonRef=\{addAthleteTriggerRef\}/);
});

test("после добавления спортсмена карточка выбранного клиента загружается заново", () => {
  assert.match(
    workspace,
    /request\(`\/clients\/\$\{detail\.id\}`\)\.then\(setDetail\)/,
  );
  assert.match(workspace, /setAddingAthlete\(false\)/);
});

test("все новые подписи формы спортсмена находятся в централизованном словаре", () => {
  assert.match(workspace, /clientAthleteUi/);
  for (const key of [
    "add",
    "title",
    "firstName",
    "lastName",
    "discipline",
    "cancel",
    "save",
    "saving",
    "saveError",
    "close",
  ]) {
    assert.match(locale, new RegExp(`${key}:\\s*"[^"]+"`));
  }
});
