import test from 'node:test';import assert from 'node:assert/strict';import {loadTargetModule} from './overview-target-loader.mjs';
const {proposeKeycrmArchiveApproval,sourceKey,normalizeMessage}=loadTargetModule('history-migration/history.ts');
const raw=(dialogueId,patch={})=>({source:'KEYCRM',account:'synthetic',channel:'INSTAGRAM',dialogueId,sourceMessageId:'one',sender:'contact:'+dialogueId,direction:'INBOUND',text:'Synthetic exact message',timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv',ordinal:0,attachments:[],...patch});
test('automatic archive proposal uses only unique exact pairs in separate confirmed dialogues of the same canonical client',()=>{
 const a=raw('a'),b=raw('b'),map=new Map([['a','client'],['b','client']]);
 const proposed=proposeKeycrmArchiveApproval([a,b],map);assert.equal(proposed.policy,'KEYCRM_SOURCE_ARCHIVE_V1');
 assert.deepEqual(proposed.equivalences,[[sourceKey(normalizeMessage(a)),sourceKey(normalizeMessage(b))].sort()]);
 for(const patch of [{text:'Different'},{direction:'OUTBOUND',sender:'staff'},{sourceTimeText:'2024-01-01 12:31'},{attachments:[{available:false,checksum:null,size:null,name:'missing.png',mimeType:'image/png'}]}])
  assert.deepEqual(proposeKeycrmArchiveApproval([a,raw('b',patch)],map).equivalences,[]);
 assert.deepEqual(proposeKeycrmArchiveApproval([a,b],new Map([['a','client'],['b','other']])).equivalences,[]);
});
test('archive proposal refuses unconfirmed mappings, unsupported time/media and ambiguous cross-dialogue repeats',()=>{
 const map=new Map([['a','client'],['b','client']]);
 assert.throws(()=>proposeKeycrmArchiveApproval([raw('a')],new Map()));
 assert.throws(()=>proposeKeycrmArchiveApproval([raw('a',{sourceTimeText:undefined})],map));
 assert.throws(()=>proposeKeycrmArchiveApproval([raw('a'),raw('b'),raw('b',{sourceMessageId:'two',ordinal:1})],map));
 // Equal text repeated within one source dialogue retains distinct original IDs.
 assert.deepEqual(proposeKeycrmArchiveApproval([raw('a'),raw('a',{sourceMessageId:'two',ordinal:1})],map).equivalences,[]);
});

test('automatic proposal refuses matching unverified media slots instead of inventing aliases or silent duplicates',()=>{
 const map=new Map([['a','client'],['b','client']]);
 const missing={name:'unverified-attachment-1',mimeType:'application/octet-stream',size:null,checksum:null,available:false};
 for(const text of ['', 'Same caption']){
  const messages=[raw('a',{text,attachments:[missing]}),raw('b',{text,attachments:[{...missing}]})];
  const before=structuredClone(messages);
  assert.throws(()=>proposeKeycrmArchiveApproval(messages,map),/вложен|провер/iu);
  assert.deepEqual(messages,before,'source inventory stays immutable when deferring ambiguous media');
 }
});

test('automatic proposal refuses reversed same-minute source order instead of approving an unreadable cycle',()=>{
 const rows=[raw('a',{text:'X',sourceMessageId:'x',ordinal:0}),raw('a',{text:'Y',sourceMessageId:'y',ordinal:1}),
  raw('b',{text:'Y',sourceMessageId:'y',ordinal:0}),raw('b',{text:'X',sourceMessageId:'x',ordinal:1})];
 assert.throws(()=>proposeKeycrmArchiveApproval(rows,new Map([['a','client'],['b','client']])),/порядок|цикл/iu);
});

test('consistent or different-minute source order still proposes exact text pairs without mutating sources',()=>{
 const map=new Map([['a','client'],['b','client']]);
 const rows=[raw('a',{text:'X',sourceMessageId:'x',ordinal:0}),raw('a',{text:'Y',sourceMessageId:'y',ordinal:1}),
  raw('b',{text:'X',sourceMessageId:'x',ordinal:0}),raw('b',{text:'Y',sourceMessageId:'y',ordinal:1})];
 const before=structuredClone(rows);
 assert.equal(proposeKeycrmArchiveApproval(rows,map).equivalences.length,2);assert.deepEqual(rows,before);
 const separate=rows.map((m,i)=>({...m,sourceTimeText:i%2?'2024-01-01 12:31':m.sourceTimeText,ordinal:i>=2?1-m.ordinal:m.ordinal}));
 assert.equal(proposeKeycrmArchiveApproval(separate,map).equivalences.length,2,'constraints never invent order across different instants');
});
