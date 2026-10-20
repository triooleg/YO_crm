import{readFile}from"node:fs/promises";import test from"node:test";import assert from"node:assert/strict";import vm from"node:vm";import ts from"typescript";import{createRequire}from"node:module";
const schema=await readFile(new URL("../../../packages/database/prisma/schema.prisma",import.meta.url),"utf8");
const controller=await readFile(new URL("../src/finance/finance.controller.ts",import.meta.url),"utf8").catch(()=>(""));
const service=await readFile(new URL("../src/finance/finance.service.ts",import.meta.url),"utf8").catch(()=>(""));
const invoicePdf=await readFile(new URL("../src/finance/invoice-pdf.ts",import.meta.url),"utf8").catch(()=>(""));
test("С„РёРЅР°РЅСЃС‹ РёРјРµСЋС‚ РЅР°СЃС‚СЂР°РёРІР°РµРјС‹Рµ СЃС‚Р°С‚СЊРё СЂР°СЃС…РѕРґРѕРІ Рё Р°СЂС…РёРІРёСЂСѓРµРјС‹Рµ СЂР°СЃС…РѕРґС‹",()=>{assert.match(schema,/model ExpenseCategory/);assert.match(schema,/model Expense/);assert.match(schema,/archivedAt\s+DateTime\?/);assert.match(controller,/@Post\("expense-categories"\)/);assert.match(controller,/@Post\("expenses"\)/)});
test("СЃРІРѕРґРєР° СЃСЂР°РІРЅРёРІР°РµС‚ РІС‹Р±СЂР°РЅРЅС‹Р№ РјРµСЃСЏС† СЃ РїСЂРµРґС‹РґСѓС‰РёРј РїРµСЂРёРѕРґРѕРј",()=>{assert.match(controller,/@Get\(\)/);assert.match(service,/previous/);assert.match(service,/month/);assert.match(service,/expensesMinor/);assert.match(service,/profitMinor/)});
test("РёРЅРІРѕР№СЃ РїСЂРёРІСЏР·Р°РЅ Рє Р·Р°РєР°Р·Сѓ Рё С…СЂР°РЅРёС‚ СЂРµРґР°РєС‚РёСЂСѓРµРјС‹Р№ СЃРЅРёРјРѕРє",()=>{assert.match(schema,/model Invoice/);assert.match(schema,/orderId\s+String/);assert.match(schema,/seller\s+Json/);assert.match(schema,/customer\s+Json/);assert.match(schema,/items\s+Json/);assert.match(controller,/@Post\("invoices"\)/);assert.match(controller,/@Patch\("invoices\/:id"\)/);assert.match(controller,/@Get\("invoices\/:id\/document"\)/)});
test("РЅР°СЃС‚СЂРѕР№РєРё РІР»РёСЏСЋС‚ РЅР° СЃР»РµРґСѓСЋС‰РёР№ РёРЅРІРѕР№СЃ",()=>{assert.match(service,/invoicePrefix/);assert.match(service,/appSetting/)});

test("С„РёРЅР°РЅСЃРѕРІР°СЏ Р·Р°РїРёСЃСЊ Рё Р°СѓРґРёС‚ Р°С‚РѕРјР°СЂРЅС‹",()=>{for(const name of ["createCategory","createExpense","saveSetting","updateInvoice"]){const start=service.indexOf("async "+name),end=service.indexOf("\n async ",start+7),block=service.slice(start,end<0?service.length:end);assert.match(block,/\$transaction/);assert.match(block,/tx\.auditLog\.create/)}const update=service.slice(service.indexOf("async updateInvoice"),service.indexOf("async document"));assert.match(update,/tx\.activity\.create/);assert.match(update,/INVOICE_UPDATED/)});
test("invoice due date is nullable and cannot precede issue date",()=>{assert.match(service,/dueDate===null/);assert.match(service,/dueDate.*issueDate|issueDate.*dueDate/);assert.match(service,/dueDate&&dueDate<issueDate/)});
test("paid invoice requires real payment and closed invoices are immutable",()=>{assert.match(service,/InvoiceStatus\.PAID/);assert.match(service,/payments/);assert.match(service,/invoices/);assert.match(service,/allocated/);assert.match(service,/before.status===InvoiceStatus.PAID\|\|before.status===InvoiceStatus.CANCELLED/);assert.doesNotMatch(controller,/@Patch\("invoices\/:id"\) @Roles\([^\n]*MANAGER/)});
test("expenses and categories support audited edit and archive",()=>{assert.match(controller,/@Patch\("expenses\/:id"\)/);assert.match(controller,/@Delete\("expenses\/:id"\)/);assert.match(controller,/@Patch\("expense-categories\/:id"\)/);assert.match(service,/async updateExpense/);assert.match(service,/async archiveExpense/);assert.match(service,/async updateCategory/);assert.match(service,/archivedAt:new Date/);assert.match(service,/tx\.auditLog\.create/)});
test("finance summary exposes category and monthly report cuts",()=>{assert.match(service,/categoryBreakdown/);assert.match(service,/monthlyTrend/);assert.match(service,/previous/)});

test("expense relations require active records",()=>{assert.match(service,/validateExpenseRelations/);assert.match(service,/active:true/);assert.match(service,/archivedAt:null/);assert.match(service,/name=d\.name\.trim\(\)/)})

test("validates only changed expense relations",()=>{const update=service.slice(service.indexOf("async updateExpense"),service.indexOf("async archiveExpense"));assert.match(update,/d\.categoryId!==undefined.*validateExpenseCategory/);assert.match(update,/d\.orderId!==undefined&&d\.orderId!==null.*validateExpenseOrder/);assert.doesNotMatch(update,/validateExpenseRelations/)})

test("invoice download is a real PDF with safe inline and attachment responses",()=>{
 assert.match(controller,/application\/pdf/);
 assert.match(controller,/download==="1"\?"attachment":"inline"/);
 assert.match(controller,/filename=.*invoice-.*\.pdf/);
 assert.match(service,/renderInvoicePdf/);
 assert.match(invoicePdf,/PDFDocument/);
 assert.match(invoicePdf,/Ubuntu/);
 assert.match(invoicePdf,/safeText/);
 assert.doesNotMatch(controller,/\.html"/);
});
test("rendered PDF total is derived from integer minor units",()=>{const javascript=ts.transpileModule(invoicePdf,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,module={exports:{}},require=createRequire(import.meta.url);vm.runInNewContext(javascript,{module,exports:module.exports,require,__dirname:new URL("../src/finance",import.meta.url).pathname,Buffer,Intl,console});const strings=module.exports.invoicePdfStrings({number:"INV-1",language:"ru",currency:"UAH",issueDate:new Date(),dueDate:null,seller:{},customer:{},items:[{description:"Купальник",quantity:1,amountMinor:123456},{description:"Декор",quantity:2,amountMinor:25000}],notes:null,totalMinor:undefined});assert.equal(strings.totalMinor,173456);assert.match(strings.total,/1[\s\u00a0\u202f]734,56/);assert.doesNotMatch(strings.total,/не число|NaN/i)});
