import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {loadTargetModule} from './overview-target-loader.mjs';
const {orderArchiveMinuteTies}=loadTargetModule('communications/inbox-archive-order.ts');

test('native Node imports the actual tools TypeScript re-export without a transpiler or extensionless dependency',()=>{
 const tool=new URL('../../../tools/migrator-agent/src/history.ts',import.meta.url).href;
 const code=`import assert from 'node:assert/strict';
  import {orderArchiveMinuteTies,proposeKeycrmArchiveApproval} from ${JSON.stringify(tool)};
  const raw=(dialogueId,text,ordinal)=>({source:'KEYCRM',account:'synthetic',channel:'INSTAGRAM',dialogueId,sourceMessageId:text,sender:'contact:'+dialogueId,direction:'INBOUND',text,ordinal,attachments:[],timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv'});
  const scope=new Map([['a','client'],['b','client']]);
  assert.equal(proposeKeycrmArchiveApproval([raw('a','X',0),raw('b','X',0)],scope).equivalences.length,1);
  assert.throws(()=>proposeKeycrmArchiveApproval([raw('a','X',0),raw('a','Y',1),raw('b','Y',0),raw('b','X',1)],scope));
  const ordinary=[{id:'native',conversationId:'chat',effectiveAt:new Date('2024-01-01T00:00:00Z'),metadata:null}];
  assert.deepEqual(orderArchiveMinuteTies(ordinary),ordinary);`;
 const child=spawnSync(process.execPath,['--input-type=module','--eval',code],{encoding:'utf8',timeout:15000});
 assert.ifError(child.error);assert.equal(child.status,0,child.stderr);
});

test('API CommonJS wrapper exposes the same single ordering implementation as history',()=>{
 assert.equal(orderArchiveMinuteTies,loadTargetModule('history-migration/history.ts').orderArchiveMinuteTies);
});
const variant=(dialogue,ordinal,account='account')=>({ordinal,sourceKey:JSON.stringify(['KEYCRM',account,'INSTAGRAM',dialogue,String(ordinal)])});
const row=(id,variants,conversationId='chat',effectiveAt=new Date('2024-01-01T10:30:00Z'))=>({id,conversationId,effectiveAt,metadata:variants?{historyArchive:{policy:'KEYCRM_SOURCE_ARCHIVE_V1',sourceVariants:variants}}:null});

test('keeps per-dialogue constraints independently of the chosen source representative',()=>{
 const x=row('X',[variant('A',99)]),y=row('Y',[variant('B',0),variant('A',100)]),z=row('Z',[variant('B',1)]);
 assert.deepEqual(orderArchiveMinuteTies([x,z,y]).map(m=>m.id),['Z','Y','X']);
 assert.deepEqual(y.metadata.historyArchive.sourceVariants,[variant('B',0),variant('A',100)],'reader never rewrites original provenance');
});
test('does not infer precedence across conversations, accounts or different instants',()=>{
 for(const other of [row('Y',[variant('A',0)],'other'),row('Y',[variant('A',0,'other')]),row('Y',[variant('A',0)],'chat',new Date('2024-01-01T10:29:00Z'))]){
  const input=[row('X',[variant('A',99)]),other];assert.deepEqual(orderArchiveMinuteTies(input),input);
 }
 const ordinary=[row('normal-z'),row('normal-a')];assert.deepEqual(orderArchiveMinuteTies(ordinary),ordinary);
 for(const malformed of [null,[],{},'bad',{historyArchive:{policy:'KEYCRM_SOURCE_ARCHIVE_V1',sourceVariants:[{ordinal:0,sourceKey:'bad-json'}]}}]){
  const input=[{...row('Z'),metadata:malformed},row('A')];assert.deepEqual(orderArchiveMinuteTies(input),input);
 }
});
test('conflicting cross-dialogue equivalences refuse an invented timeline',()=>{
 assert.throws(()=>orderArchiveMinuteTies([row('X',[variant('A',0),variant('B',1)]),row('Y',[variant('A',1),variant('B',0)])]),/противоречив/);
});

test('10,000 tied rows use linear bucket barriers instead of 25 million edges',()=>{
 const rows=Array.from({length:10000},(_,i)=>row('m-'+i,[variant('A',i<5000?0:Number.MAX_SAFE_INTEGER)]));
 const before=process.memoryUsage().heapUsed,start=performance.now(),result=orderArchiveMinuteTies(rows);
 assert.equal(result.length,10000);assert.ok(result.slice(0,5000).every(m=>m.metadata.historyArchive.sourceVariants[0].ordinal===Number.MAX_SAFE_INTEGER));
 // Generous limits catch the measured quadratic implementation (~25M edges)
 // without pinning normal execution to a workstation-specific millisecond SLA.
 assert.ok(process.memoryUsage().heapUsed-before<96*1024*1024,'graph allocation must remain bounded');
 assert.ok(performance.now()-start<5000,'bounded tie ordering must not monopolize polling');
});
