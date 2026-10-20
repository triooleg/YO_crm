import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
const view=await readFile(new URL("../components/orders-workspace.tsx",import.meta.url),"utf8");
const styles=await readFile(new URL("../app/orders-workspace.css",import.meta.url),"utf8");
test("order headers and rows share one column grid",()=>{assert.match(view,/ORDER_COLUMN_WIDTHS/);assert.match(view,/--orders-grid/);assert.match(styles,/grid-template-columns:var\(--orders-grid\)/);assert.match(view,/changeListStatus/);assert.match(view,/orders-inline-status/)});
