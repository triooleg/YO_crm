import{readFile}from"node:fs/promises";import test from"node:test";import assert from"node:assert/strict";
const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
let finance=(await readFile(new URL("../components/finance-workspace.tsx",import.meta.url),"utf8").catch(()=>("")))+(await readFile(new URL("../components/invoice-editor.tsx",import.meta.url),"utf8").catch(()=>("")));
const reportParts=(await Promise.all(['finance-report-charts.tsx','finance-report-dialogs.tsx','finance-report-table.tsx'].map(file=>readFile(new URL('../components/'+file,import.meta.url),'utf8')))).join('\n');
finance+=reportParts;
const orders=await readFile(new URL("../components/orders-workspace.tsx",import.meta.url),"utf8");
const settings=await readFile(new URL("../components/settings-workspace.tsx",import.meta.url),"utf8");
test("раздел Финансы открывает рабочее пространство",()=>{assert.match(shell,/FinanceWorkspace/);assert.match(finance,/ui\.previousPeriod/);assert.match(finance,/ui\.categories/);assert.match(finance,/financeUi\.createInvoiceAction/)});
test("редактор инвойса поддерживает снимок данных и документ",()=>{assert.match(finance,/financeUi\.invoiceEditor/);assert.match(finance,/seller/);assert.match(finance,/customer/);assert.match(finance,/items/);assert.match(finance,/\/document/)});
test("заказ показывает связанные инвойсы",()=>{assert.match(orders,/invoices/);assert.match(orders,/ordersUi\.viewInvoice/);assert.match(orders,/ordersUi\.download/)});
test("настройки вынесены в отдельную страницу",()=>{assert.match(shell,/SettingsWorkspace/);assert.match(settings,/invoicePrefix/);assert.match(settings,/defaultCurrency/);assert.match(settings,/depositPercent/);assert.match(settings,/\/finance\/settings/)});
test("invoice editor supports rows, snapshots and create/update routes",()=>{for(const token of [/setInvoice/,/setItems/,/addInvoiceItem/,/removeInvoiceItem/,/financeUi\.addPosition/,/financeUi\.invoiceTotal/,/\/finance\/invoices\//,/method:\s*"PATCH"/,/request\("\/finance\/invoices",\s*\{\s*method:\s*"POST"/,/request\("\/finance\/documents",\s*\{\s*method:\s*"POST"/])assert.match(finance,token)});
test("document editor selects an allowlisted template and previews PDF",()=>{for(const token of [/\/finance\/document-templates/,/\/finance\/document-fields\//,/\/api\/finance\/documents\/preview/,/fieldKeys/,/financeUi\.documentTemplate/,/financeUi\.documentPreview/])assert.match(finance,token)});
test("legacy invoices receive a safe field fallback and preview their saved legacy PDF",()=>{assert.match(finance,/invoice && !fieldKeys\.length/);assert.match(finance,/contentLocked \|\| !invoice\.templateSnapshot/);assert.match(finance,/\/api\/finance\/invoices\/\$\{encodeURIComponent\(invoice!\.id\)\}\/document/)});
test("generic documents keep issue and due dates while invoice rows retain item properties",()=>{assert.match(finance,/properties/);assert.match(finance,/const \{ items: _items, \.\.\.orderDocumentPayload \} = payload/);assert.doesNotMatch(finance,/issueDate: _issueDate/)});
test("invoice editor exposes dates language and status",()=>{for(const token of [/issueDate/,/dueDate/,/language/,/status/,/financeUi\.issueDate/,/financeUi\.dueDate/,/financeUi\.invoiceStatus/])assert.match(finance,token)});
test("archived order invoice keeps an editor fallback",()=>{assert.match(finance,/\/finance\/report\/orders\//);assert.match(finance,/order\.archivedAt/)});
test("finance workspace edits and archives expenses",()=>{assert.match(finance,/FinanceExpenseDialog/);assert.match(finance,/editExpense/);assert.match(finance,/archiveExpense/);assert.match(finance,/ui\.archive/)});
// The fiscal integration replaces the old cash-only graph inputs; mounted-browser
// acceptance covers amounts and drilldowns, while this guard retains the chart surfaces.
test("finance workspace retains monthly and classified expense analytics",()=>{assert.match(finance,/finance-report-bar-chart/);assert.match(finance,/data-expense-structure/);assert.match(finance,/onCategory/);assert.match(finance,/onTax/)});

test("preserves archived expense relations and shows modal errors",()=>{assert.match(finance,/row\.categoryName/);assert.match(finance,/category!==row\.categoryId/);assert.match(finance,/order!==\(row\.orderId/);assert.match(finance,/role="alert"/);assert.match(finance,/aria-hidden="true"/);assert.match(finance,/role="img"/);assert.match(finance,/download=1/)})
