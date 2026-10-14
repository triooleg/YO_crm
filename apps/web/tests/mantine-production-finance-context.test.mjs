import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const production=await readFile(new URL("../components/production-workspace.tsx",import.meta.url),"utf8");
const planner=await readFile(new URL("../components/production-planner-view.tsx",import.meta.url),"utf8");
const finance=await readFile(new URL("../components/finance-workspace.tsx",import.meta.url),"utf8");

test("новые действия производства и финансов используют общие Mantine-контролы",()=>{
  assert.match(production,/import \{ CrmButton \} from "\.\/crm\/settings-controls"/);
  assert.ok(((production+planner).match(/<CrmButton[^>]*tone="secondary"/g)||[]).length>=2);
  assert.match(finance,/import \{ CrmButton \} from ['"]\.\/crm\/settings-controls['"]/);
  assert.match(finance,/<CrmButton[^>]*tone="secondary"/);
});
