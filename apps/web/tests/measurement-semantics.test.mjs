import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const module={exports:{}};
const code=ts.transpileModule(readFileSync(new URL('../lib/measurement-semantics.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const native=createRequire(import.meta.url),cache=new Map();
function load(file){if(cache.has(file))return cache.get(file).exports;const m={exports:{}};cache.set(file,m);const source=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;new Function('module','exports','require',source)(m,m.exports,name=>name.startsWith('.')?load(resolve(dirname(file),name+'.ts')):native(name));return m.exports;}
new Function('module','exports','require',code)(module,module.exports,()=>load(resolve(dirname(fileURLToPath(import.meta.url)),'../lib/i18n.ts')));
const {measurementSemanticLabel,measurementSemanticNote,measurementDefinitionSupported,measurementPresetForDefinition,measurementCopyValues,measurementComparableNumbers}=module.exports;
test('same sleeve number uses contextual labels, unknown definitions never fall back to legacy',()=>{
 assert.equal(measurementSemanticLabel(6,'Длина рукава (+2 см)',null),'Длина рукава (+2 см)');
 assert.equal(measurementSemanticLabel(6,'Длина рукава (+2 см)','PARENT_BODY_V1'),'Длина рукава (без припуска)');
 assert.match(measurementSemanticNote('PARENT_BODY_V1'),/прибавку учитывать отдельно/);
 assert.equal(measurementDefinitionSupported('FUTURE'),false);
 assert.match(measurementSemanticLabel(6,'Длина рукава (+2 см)','FUTURE'),/неизвестно/);
});
test('body definitions cannot consume allowance sleeve presets or nearest-height scoring',()=>{
 const legacy={m1:70,m6:44};
 assert.deepEqual(measurementPresetForDefinition(legacy,null),legacy);
 assert.deepEqual(measurementPresetForDefinition(legacy,'PARENT_BODY_V1'),{m1:70});
 assert.equal(measurementComparableNumbers('PARENT_BODY_V1').includes(6),false);
 assert.equal(measurementComparableNumbers(null).includes(6),true);
 assert.deepEqual(measurementPresetForDefinition(legacy,'FUTURE'),{});
 assert.deepEqual(legacy,{m1:70,m6:44});
});
test('legacy to body copy omits sleeve instead of adding or subtracting allowance',()=>{
 const original={m1:70,m6:44};
 assert.deepEqual(measurementCopyValues(original,null,'PARENT_BODY_V1'),{m1:70});
 assert.deepEqual(measurementCopyValues(original,'PARENT_BODY_V1','PARENT_BODY_V1'),original);
 assert.throws(()=>measurementCopyValues(original,'FUTURE',null),/Неизвестное/);
});
