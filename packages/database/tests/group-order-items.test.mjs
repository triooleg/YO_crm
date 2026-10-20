import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const schema=readFileSync(new URL("../prisma/schema.prisma",import.meta.url),"utf8");
test("позиция группового заказа связывает спортсмена замеры модель и производство",()=>{
  const item=schema.match(/model OrderItem \{[\s\S]*?\n\}/)?.[0]??"";
  for(const field of ["athleteId","measurementId","modelImagePath","productionStatus"]){assert.match(item,new RegExp(field))}
});
