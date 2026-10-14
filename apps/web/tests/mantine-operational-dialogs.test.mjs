import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read=path=>fs.readFileSync(new URL(path,import.meta.url),"utf8");
test("операционные диалоги используют единый Mantine Modal",()=>{
 const modal=read("../components/crm/modal.tsx"),locale=read("../lib/i18n.ts"),shipping=read("../components/shipping-workspace.tsx"),finance=read("../components/finance-workspace.tsx"),invoice=read("../components/invoice-editor.tsx"),tasks=read("../components/tasks-workspace.tsx");
 assert.match(modal,/import \{ Modal \} from "@mantine\/core"/);
 assert.match(modal,/<Modal opened/); assert.match(modal,/closeOnEscape=\{!busy\}/); assert.match(modal,/closeOnClickOutside=\{!busy\}/); assert.match(modal,/trapFocus returnFocus/);
 assert.match(locale,/export const crmModalUi/); assert.match(modal,/aria-label=\{crmModalUi\.close\}/);
 for(const source of[shipping,finance,invoice,tasks]){assert.match(source,/CrmModal/);assert.doesNotMatch(source,/className="finance-overlay"/)}
 assert.match(tasks,/<Dialog title=\{task\.id \? tasksUi\.editTask : tasksUi\.newTask\} close=\{close\} busy=\{saving\}>/);
 assert.match(tasks,/<CrmModal title=\{title\} close=\{close\} busy=\{busy\}/);
 assert.match(tasks,/<button type="button" onClick=\{close\} disabled=\{saving\}>/);
 assert.match(tasks,/const submittingRef = useRef\(false\)/);
 assert.match(tasks,/if \(submittingRef\.current\) return/);
});
test("денежные и временные контракты не изменены",()=>{
 const shipping=read("../components/shipping-workspace.tsx"),finance=read("../components/finance-report-dialogs.tsx"),invoice=read("../components/invoice-editor.tsx");
 assert.match(shipping,/costMinor:Math\.round\(Number\(f\.get\("cost"\)\)\*100\)/); assert.match(shipping,/T12:00:00Z/);
 assert.match(finance,/parseOrderPriceMinor\(amount\)/); assert.match(finance,/T12:00:00Z/);
 assert.match(invoice,/amountMinor: Math\.round\(Number\(e\.target\.value\) \* 100\)/); assert.match(invoice,/T12:00:00Z/);
});
