import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync(new URL('../lib/order-context.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{module,exports:module.exports,URLSearchParams,URL});
test('Finance deep link opens only the requested order tab; ordinary links keep details',()=>{
  const initial=module.exports.orderInitialTab;
  assert.equal(initial('?section=orders&orderId=abc&tab=finance','abc'),'finance');
  assert.equal(initial('?section=orders&orderId=abc&tab=finance','other'),'details');
  assert.equal(initial('?section=orders&orderId=abc','abc'),'details');
  assert.equal(initial('?section=orders&orderId=abc&tab=invalid','abc'),'details');
});
