import{readFile}from"node:fs/promises";import test from"node:test";import assert from"node:assert/strict";
const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
const finance=(await readFile(new URL("../components/finance-workspace.tsx",import.meta.url),"utf8").catch(()=>("")))+(await readFile(new URL("../components/invoice-editor.tsx",import.meta.url),"utf8").catch(()=>("")));
const orders=await readFile(new URL("../components/orders-workspace.tsx",import.meta.url),"utf8");
const settings=await readFile(new URL("../components/settings-workspace.tsx",import.meta.url),"utf8");
test("раздел Финансы открывает рабочее пространство",()=>{assert.match(shell,/FinanceWorkspace/);assert.match(finance,/financeUi\.comparisonTitle/);assert.match(finance,/financeUi\.expenseCategories/);assert.match(finance,/financeUi\.createInvoiceAction/)});
test("редактор инвойса поддерживает снимок данных и документ",()=>{assert.match(finance,/financeUi\.invoiceEditor/);assert.match(finance,/seller/);assert.match(finance,/customer/);assert.match(finance,/items/);assert.match(finance,/\/document/)});
test("заказ показывает связанные инвойсы",()=>{assert.match(orders,/invoices/);assert.match(orders,/ordersUi\.viewInvoice/);assert.match(orders,/ordersUi\.download/)});
test("настройки вынесены в отдельную страницу",()=>{assert.match(shell,/SettingsWorkspace/);assert.match(settings,/invoicePrefix/);assert.match(settings,/defaultCurrency/);assert.match(settings,/depositPercent/);assert.match(settings,/\/finance\/settings/)});
test("invoice editor supports rows and updates",()=>{for(const token of [/invoiceToEdit/,/setItems/,/addInvoiceItem/,/removeInvoiceItem/,/financeUi\.addPosition/,/financeUi\.invoiceTotal/,/method:\s*invoice\?\.id\s*\?\s*"PATCH"\s*:\s*"POST"/])assert.match(finance,token)});
test("invoice editor exposes dates language and status",()=>{for(const token of [/issueDate/,/dueDate/,/language/,/status/,/financeUi\.issueDate/,/financeUi\.dueDate/,/financeUi\.invoiceStatus/])assert.match(finance,token)});
test("archived order invoice keeps an editor fallback",()=>{assert.match(finance,/invoiceOrderForEdit/);assert.match(finance,/item\.order/)});
test("finance workspace edits and archives expenses",()=>{assert.match(finance,/expenseToEdit/);assert.match(finance,/editExpense/);assert.match(finance,/archiveExpense/);assert.match(finance,/financeUi\.archive/)});
test("finance workspace renders monthly and category analytics",()=>{assert.match(finance,/categoryBreakdown/);assert.match(finance,/monthlyTrend/);assert.match(finance,/financeUi\.expenseStructure/);assert.match(finance,/financeUi\.monthlyDynamics/)});

test("preserves archived expense relations and shows modal errors",()=>{assert.match(finance,/archivedValue/);assert.match(finance,/categoryId!==expenseToEdit\.categoryId/);assert.match(finance,/orderId!==\(expenseToEdit\.orderId/);assert.match(finance,/role="alert"/);assert.match(finance,/aria-hidden="true"/);assert.match(finance,/role="img"/);assert.match(finance,/download=1/)})
