import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const production = await readFile(new URL("../components/production-workspace.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../components/crm-shell.tsx", import.meta.url), "utf8");
const dictionary = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");
const styles = await readFile(new URL("../app/production-workspace.css", import.meta.url), "utf8");
const icon = await readFile(new URL("../app/icon.svg", import.meta.url), "utf8");

test("раздел Производство открывает рабочую канбан-доску", () => {
  assert.match(shell, /ProductionWorkspace/);
  assert.match(production, /NOT_SCHEDULED/);
  for (const status of ["MATERIALS", "CUTTING", "SEWING", "DECORATION", "QUALITY_CONTROL", "READY"]) {
    assert.match(production, new RegExp(status));
  }
  assert.match(styles, /production-board/);
});

test("производственная карточка показывает готовность и меняет статус через API", () => {
  for (const token of ["modelImagePath", "depositRequiredMinor", "measurement", "requiredDeliveryAt"]) {
    assert.match(production, new RegExp(token));
  }
  assert.match(production, /PATCH/);
  assert.match(production, /productionStatus/);
  assert.match(dictionary, /productionUi/);
});

test("приложение публикует собственную иконку Yoleotard", () => {
  assert.match(icon, /<svg/);
  assert.match(icon, />Y</);
});
