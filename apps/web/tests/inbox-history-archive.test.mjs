import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const source=readFileSync(new URL('../lib/inbox-history-archive.ts',import.meta.url),'utf8');
const module={exports:{}};
vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{module,exports:module.exports});
const {inboxHistoryArchive}=module.exports;
const meta={historyArchive:{policy:'KEYCRM_SOURCE_ARCHIVE_V1',time:{precision:'MINUTE',timezone:'Europe/Kyiv',original:'2024-01-01 12:30'},missingAttachments:[{name:'Photo',available:false,checksum:null,size:null},{name:'Photo',available:false,checksum:null,size:null}]}};
test('archive presentation retains minute precision and repeated missing media slots',()=>{
  const actual=inboxHistoryArchive(meta);
  assert.equal(actual.originalTime,'2024-01-01 12:30');assert.equal(actual.timezone,'Europe/Kyiv');
  assert.deepEqual(Array.from(actual.missingNames),['Photo','Photo']);
});
test('does not turn source links into usable attachments or affect ordinary messages',()=>{
  assert.equal(inboxHistoryArchive(null),null);assert.equal(inboxHistoryArchive({attachments:[]}),null);
  assert.equal(inboxHistoryArchive({historyArchive:{policy:'other'}}),null);
  const changed=structuredClone(meta);changed.historyArchive.missingAttachments[0].url='https://example.test/expired';
  const result=inboxHistoryArchive(changed);assert.deepEqual(Object.keys(result).sort(),['missingNames','originalTime','timezone']);
  assert.equal(inboxHistoryArchive({historyArchive:{policy:'KEYCRM_SOURCE_ARCHIVE_V1',missingAttachments:'invalid'}}).missingNames.length,0);
});
