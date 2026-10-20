import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import ts from 'typescript';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const cache=new Map();
export function loadTax(file){
 const filename=path.resolve(new URL('../src/taxes/',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),file);
 if(cache.has(filename))return cache.get(filename).exports;
 const module={exports:{}};cache.set(filename,module);
 const custom=name=>name.startsWith('.')?loadFile(path.resolve(path.dirname(filename),name)+'.ts'):require(name);
 function loadFile(f){if(cache.has(f))return cache.get(f).exports;const m={exports:{}};cache.set(f,m);const out=ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;vm.runInThisContext('(function(require,module,exports){'+out+'\n})',{filename:f})(name=>name.startsWith('.')?loadFile(path.resolve(path.dirname(f),name)+'.ts'):require(name),m,m.exports);return m.exports;}
 const out=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true}}).outputText;
 vm.runInThisContext('(function(require,module,exports){'+out+'\n})',{filename})(custom,module,module.exports);return module.exports;
}
const {TaxesService}=loadTax('taxes.service.ts');
test('service RBAC rejects manager before any database access',async()=>{
 const s=new TaxesService({},{});await assert.rejects(()=>s.settings({id:'m',role:'MANAGER'}),/прав/);
 await assert.rejects(()=>s.saveSettings({expectedRevision:0,operationKey:'x',enabled:true},{id:'a',role:'ACCOUNTANT'}),/прав/);
});
test('invalid tax date/month and ungrounded future percentage fail400 before DB access',async()=>{
 const s=new TaxesService({},{}),owner={id:'owner',role:'OWNER'},command={operationKey:'validation',expectedRevision:0};
 await assert.rejects(s.report({from:'2026-99'},owner),error=>error.getStatus()===400);
 await assert.rejects(s.closePeriod('bad',{...command,completenessEvidence:'reviewed'},owner),error=>error.getStatus()===400);
 await assert.rejects(s.publishPolicy({...command,effectiveFrom:'2035-11-01',group:3,unifiedMode:'PERCENT',unifiedRateBps:600,fixedUnifiedMinor:null,militaryRateBps:100,esvRateBps:2200},owner),error=>error.getStatus()===400&&/основание/.test(error.message));
});
