import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
const css=await readFile(new URL("../app/crm-shell.css",import.meta.url),"utf8");
test("все разделы используют единый развёрнутый интерфейс входящих",()=>{assert.match(shell,/className="crm-shell inbox-reference-shell"/);assert.match(shell,/<header className="crm-topbar">/);assert.match(shell,/crm-nav-label/);assert.doesNotMatch(shell,/nav-collapsed/);assert.doesNotMatch(shell,/setCollapsed/);assert.doesNotMatch(shell,/crm-collapse/);assert.match(shell,/data-tooltip=\{name\}/);assert.match(shell,/title=\{name\}/);assert.match(css,/button:hover::after/);assert.match(css,/button:focus-visible::after/)});
test("поиск и уведомления из общей шапки открывают входящие",()=>{assert.match(shell,/updateGlobalSearch/);assert.match(shell,/sectionId!=="inbox"\)navigate\("inbox"\)/);assert.match(shell,/onClick=\{showUnread\}/)});
test("из входящих можно создать клиента с источником",()=>{assert.match(shell,/Клиент из входящих/);assert.match(shell,/source:data.source/);assert.match(shell,/fetch\("\/api\/clients"/)});
