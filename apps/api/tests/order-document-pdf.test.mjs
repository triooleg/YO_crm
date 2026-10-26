import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const model = await readFile(new URL("../src/finance/order-document-model.ts", import.meta.url), "utf8");
let pdf = await readFile(new URL("../src/finance/order-document-pdf.ts", import.meta.url), "utf8");
const modelJs = ts.transpileModule(model, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
const modelModule = { exports: {} }, requireFromHere = createRequire(import.meta.url);
vm.runInNewContext(modelJs, { module: modelModule, exports: modelModule.exports, require: requireFromHere, Intl, Date, structuredClone });
const pdfJs = ts.transpileModule(pdf, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
const pdfModule = { exports: {} };
const localRequire = specifier => specifier === "./order-document-model" ? modelModule.exports : requireFromHere(specifier);
vm.runInNewContext(pdfJs, { module: pdfModule, exports: pdfModule.exports, require: localRequire, Intl, Date, Buffer, __dirname: new URL("../src/finance", import.meta.url).pathname });

test("PDF-представление использует язык шаблона и minor units", () => {
  const view = pdfModule.exports.orderDocumentPdfStrings({ title: "FACTURE", language: "fr", templateSnapshot: { fieldKeys: ["finance.total"], payment: { iban: "TEST-IBAN" } }, dataSnapshot: { currency: "EUR", fieldKeys: ["finance.total"], values: { "finance.total": { minor: 40000, currency: "EUR" } }, items: [] } });
  assert.equal(view.copy.billTo, "Facturé à");
  assert.match(view.fields[0].value, /400,00/);
  assert.equal(view.template.payment.iban, "TEST-IBAN");
});

test("PDF-представление не возвращает отключённые таблицы и клиентские поля", () => {
  const view = pdfModule.exports.orderDocumentPdfStrings({ title: "INVOICE", language: "en", templateSnapshot: { fieldKeys: ["order.number"] }, dataSnapshot: { currency: "EUR", orderNumber: "YO-701", fieldKeys: ["order.number"], values: { "order.number": "YO-701" }, items: [], payments: [] } });
  assert.equal(view.items.length, 0);
  assert.equal(view.payments.length, 0);
  assert.equal(view.snapshot.values["client.name"], undefined);
});
