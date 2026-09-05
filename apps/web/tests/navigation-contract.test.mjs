import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
const css=await readFile(new URL("../app/crm-shell.css",import.meta.url),"utf8");
test("меню входящих развёрнуто, остальные разделы сохраняют компактную навигацию",()=>{assert.match(shell,/sectionId==="inbox"\?"crm-shell inbox-reference-shell":"crm-shell nav-collapsed"/);assert.match(shell,/crm-nav-label/);assert.doesNotMatch(shell,/setCollapsed/);assert.doesNotMatch(shell,/crm-collapse/);assert.match(shell,/data-tooltip=\{name\}/);assert.match(shell,/title=\{name\}/);assert.match(css,/button:hover::after/);assert.match(css,/button:focus-visible::after/)});
test("из входящих можно создать клиента с источником",()=>{assert.match(shell,/Клиент из входящих/);assert.match(shell,/source:data.source/);assert.match(shell,/fetch\("\/api\/clients"/)});
