import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function load(path) {
  const source=readFileSync(new URL(path,import.meta.url),'utf8'),module={exports:{}};
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',js)(name=>{assert.equal(name,'./i18n');return load('../lib/i18n.ts')},module,module.exports);
  return module.exports;
}
const {invoiceErrorMessage}=load('../lib/invoice-errors.ts');
const {invoiceWorkflowUi:ui}=load('../lib/i18n.ts');

test('invoice and template logo failures use the shared Russian dictionary, not the API code',()=>{
  assert.equal(invoiceErrorMessage(new Error('INVOICE_LOGO_UNAVAILABLE')),ui.logoUnavailable);
  assert.equal(invoiceErrorMessage('INVOICE_LOGO_UNAVAILABLE','fallback'),ui.logoUnavailable);
  assert.match(ui.logoUnavailable,/логотип/);
  assert.match(readFileSync(new URL('../components/document-template-settings.tsx',import.meta.url),'utf8'),/new Error\(invoiceErrorMessage/);
});

test('existing errors and caller fallback remain compatible',()=>{
  assert.equal(invoiceErrorMessage(new Error('Other existing error')),'Other existing error');
  assert.equal(invoiceErrorMessage(null,'Template request failed'),'Template request failed');
  assert.equal(invoiceErrorMessage(undefined),ui.error);
});
