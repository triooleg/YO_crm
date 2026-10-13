import {readFile} from "node:fs/promises";import test from "node:test";import assert from "node:assert/strict";
const dto=await readFile(new URL("../src/clients/clients.dto.ts",import.meta.url),"utf8");const service=await readFile(new URL("../src/clients/measurement-data.ts",import.meta.url),"utf8");
test("базовые измерения 1 2 3 и 15 обязательны",()=>{for(const n of[1,2,3,15])assert.match(dto,new RegExp(`@ApiProperty\\(\\) @IsNumber\\(\\) @Min\\(1\\) m${n}!`))});
test("все 17 измерений сохраняются в JSON снимке",()=>{assert.match(service,/values: \{ standardHeight, \.\.\.numbered \}/);assert.match(service,/chest: dto\.m1/);assert.match(service,/torso: dto\.m15/)});
test("сервер отклоняет значения не кратные половине сантиметра",()=>{assert.match(service,/value \* 2/);assert.match(service,/шагом 0,5 см/)});
