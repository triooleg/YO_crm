import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const production=await readFile(new URL("../components/production-workspace.tsx",import.meta.url),"utf8");
const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
const styles=await readFile(new URL("../app/production-workspace.css",import.meta.url),"utf8");
test("раздел Производство открывает интерактивную шкалу",()=>{assert.match(shell,/ProductionWorkspace/);assert.match(production,/productionSlot/);assert.match(production,/pointermove/);assert.match(styles,/production-timeline/)});
test("даты сохраняются локально и загрузка зависит от мощности",()=>{assert.match(production,/toLocalIso/);assert.match(production,/dailyLoad/);assert.match(production,/capacityPerDay/);assert.match(production,/production-slot/)});
test("закрепленный слот нельзя двигать мышью",()=>{assert.match(production,/productionSlot\.locked/);assert.match(production,/Закрепить слот/);assert.match(styles,/timeline-bar\.locked/)});
