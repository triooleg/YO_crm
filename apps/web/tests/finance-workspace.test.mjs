import{readFile}from"node:fs/promises";import test from"node:test";import assert from"node:assert/strict";
const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
const finance=await readFile(new URL("../components/finance-workspace.tsx",import.meta.url),"utf8").catch(()=>(""));
const orders=await readFile(new URL("../components/orders-workspace.tsx",import.meta.url),"utf8");
const settings=await readFile(new URL("../components/settings-workspace.tsx",import.meta.url),"utf8");
test("раздел Финансы открывает рабочее пространство",()=>{assert.match(shell,/FinanceWorkspace/);assert.match(finance,/financeUi\.comparisonTitle/);assert.match(finance,/financeUi\.expenseCategories/);assert.match(finance,/financeUi\.createInvoiceAction/)});
test("редактор инвойса поддерживает снимок данных и документ",()=>{assert.match(finance,/financeUi\.invoiceEditor/);assert.match(finance,/seller/);assert.match(finance,/customer/);assert.match(finance,/items/);assert.match(finance,/\/document/)});
test("заказ показывает связанные инвойсы",()=>{assert.match(orders,/invoices/);assert.match(orders,/ordersUi\.viewInvoice/);assert.match(orders,/ordersUi\.download/)});
test("настройки вынесены в отдельную страницу",()=>{assert.match(shell,/SettingsWorkspace/);assert.match(settings,/invoicePrefix/);assert.match(settings,/defaultCurrency/);assert.match(settings,/depositPercent/);assert.match(settings,/\/finance\/settings/)});
