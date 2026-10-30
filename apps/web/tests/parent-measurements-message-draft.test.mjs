import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript'),m={exports:{}};
new Function('module','exports',ts.transpileModule(readFileSync(new URL('../lib/parent-measurements-message-draft.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(m,m.exports);
const {queueParentMeasurementDraft:queue,takeParentMeasurementDraft:take}=m.exports;
test('measurement request appends to existing draft only for selected client and only once',()=>{queue('one','Invite link',1000);assert.deepEqual(take('other','Existing',1001),{text:'Existing',applied:false});assert.deepEqual(take('one','Existing',1002),{text:'Existing\n\nInvite link',applied:true});assert.equal(take('one','Existing',1003).applied,false);});
test('expired staged text is discarded without altering a future client draft',()=>{queue('late','Invite',1000);assert.deepEqual(take('late','Keep',121001),{text:'Keep',applied:false});});
