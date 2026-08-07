import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
const viewer=await readFile(new URL("../components/measurement-viewer.tsx",import.meta.url),"utf8");
const workspace=await readFile(new URL("../components/client-workspace.tsx",import.meta.url),"utf8");
test("просмотр показывает все 17 пронумерованных замеров",()=>{assert.match(viewer,/names\.map/);assert.match(viewer,/`m\$\{number\}`/);assert.match(viewer,/\[1,2,3,15\]/)});
test("дата замеров спортсмена открывает панель просмотра",()=>{assert.match(workspace,/MeasurementViewer/);assert.match(workspace,/setViewing/);assert.match(workspace,/Просмотреть замеры/)});
