import {readFile} from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
const viewer=await readFile(new URL("../components/measurement-viewer.tsx",import.meta.url),"utf8");
const detail=await readFile(new URL("../components/clients/client-details.tsx",import.meta.url),"utf8");
test("просмотр показывает все 17 пронумерованных замеров",()=>{
 assert.match(viewer,/names\.map/);assert.match(viewer,/`m\$\{number\}`/);assert.match(viewer,/circumferenceNumbers=\[1,2,3,15\]/);
});
test("круговые замеры показывают полный и полуобхват через косую",()=>{
 assert.match(viewer,/numeric\/2/);assert.match(viewer,/см \/ .*см/);
});
test("дата последнего snapshot спортсмена открывает существующий viewer без копирования мерок",()=>{
 assert.match(detail,/athlete\.measurements\?\.\[0\]/);
 assert.match(detail,/setMeasurement\(\{name:[\s\S]*value:athlete\.measurements\[0\]!\}/);
 assert.match(detail,/ui\.viewMeasurements/);
 assert.match(detail,/<MeasurementViewer athleteName=\{measurement\.name\} measurement=\{measurement\.value\}/);
 assert.match(detail,/setMeasurement\(undefined\);overlay\(false\)/);
 assert.doesNotMatch(detail,/method:\s*"(?:PATCH|PUT)"[^}]*measurements/);
});
