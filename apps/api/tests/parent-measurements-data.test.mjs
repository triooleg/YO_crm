import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const req=createRequire(import.meta.url),ts=req('typescript');req('reflect-metadata');
function load(file){const m={exports:{}};const js=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;new Function('require','module','exports',js)(name=>name.startsWith('.')&&existsSync(resolve(dirname(file),name+'.ts'))?load(resolve(dirname(file),name+'.ts')):req(name),m,m.exports);return m.exports;}
const {normalizeParentDraft}=load(resolve(dirname(fileURLToPath(import.meta.url)),'../src/parent-measurements/parent-measurements-data.ts'));
const core={firstName:' Алина ',discipline:'RHYTHMIC_GYMNASTICS',measuredAt:'2026-10-18',values:{m1:70,m2:56,m3:72,m15:122}};
test('four required measures submit without height or the other thirteen',()=>{const d=normalizeParentDraft(core,true);assert.equal(d.firstName,'Алина');assert.deepEqual(d.values,core.values);assert.equal(d.heightCm,undefined);});
test('sleeve body length remains unchanged; absent optional values do not become zero',()=>{const d=normalizeParentDraft({...core,values:{...core.values,m6:42.5}},true);assert.equal(d.values.m6,42.5);assert.ok(!('m7' in d.values));});
test('incomplete draft is allowed but cannot be confirmed',()=>{assert.doesNotThrow(()=>normalizeParentDraft({firstName:'Алина',values:{}},false));assert.throws(()=>normalizeParentDraft({firstName:'Алина',values:{}},true));});
test('invalid steps, negative, unknown fields and injected ownership are rejected',()=>{for(const v of [70.1,-1,0,null,'70',Infinity])assert.throws(()=>normalizeParentDraft({...core,values:{...core.values,m1:v}},true));for(const addition of [{athleteId:'foreign'},{values:{...core.values,m18:10}},{discipline:'UNKNOWN'}])assert.throws(()=>normalizeParentDraft({...core,...addition},true));});
test('missing sport, impossible dates and malformed names cannot be submitted',()=>{for(const data of [{...core,discipline:undefined},{...core,measuredAt:'2026-02-30'},{...core,firstName:'  '},{...core,firstName:'a'.repeat(101)}])assert.throws(()=>normalizeParentDraft(data,true));});
