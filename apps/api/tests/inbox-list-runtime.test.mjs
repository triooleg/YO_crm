import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
const cache=new Map();
function load(file){
  file=resolve(file);if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const require=name=>{if(name.startsWith('.')){const candidate=resolve(dirname(file),name+'.ts');if(existsSync(candidate))return load(candidate);}return createRequire(file)(name);};
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true,emitDecoratorMetadata:true,esModuleInterop:true}}).outputText;
  vm.runInNewContext(code,{module,exports:module.exports,require,console,process,Buffer,URL,fetch,FormData,Headers,AbortSignal,setTimeout,clearTimeout,Date},{filename:file});
  return module.exports;
}
const {CommunicationsService}=load(new URL('../src/communications/communications.service.ts',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'));
test('закреплённая вне поиска переписка сохраняет последнее реальное сообщение',async()=>{
  const client={id:'pinned',displayName:'Pinned',inboxSpamAt:null,conversations:[{id:'chat',clientId:'pinned',channel:'FACEBOOK',unreadCount:0}]};
  const latest={clientId:'pinned',conversationId:'chat',messageId:'real',channel:'FACEBOOK',direction:'INBOUND',createdAt:new Date('2026-10-14T12:00:00Z')};
  const db={client:{findMany:async({where,select})=>select?where.id?[{id:'pinned'}]:[]:[client],findFirst:async({where})=>(where.inboxSpamAt===null?!client.inboxSpamAt:Boolean(client.inboxSpamAt))?client:null,count:async()=>0},$queryRaw:async()=>[latest],appSetting:{findMany:async()=>[]},message:{findMany:async()=>[{id:'real',content:'Real preview',direction:'INBOUND',status:'RECEIVED',messageType:'text',metadata:null,createdAt:latest.createdAt}]},order:{groupBy:async()=>[],findMany:async()=>[]},payment:{findMany:async()=>[]},conversation:{findMany:async()=>[]},clientMergeRedirect:{findMany:async()=>[]},activity:{findMany:async()=>[]}};
  const service=new CommunicationsService(db,{});
  const result=await service.list({clientId:'pinned',search:'Other',limit:15,offset:0});
  assert.equal(result.preferredItem.conversations[0].messages[0].content,'Real preview');
  assert.equal(result.preferredItem.conversations[0].lastMessageAt.toISOString(),'2026-10-14T12:00:00.000Z');
  assert.equal(result.preferredItem.waitingForReply,true);assert.equal(result.total,0);
  client.inboxSpamAt=new Date();
  assert.equal((await service.list({clientId:'pinned',search:'Other',limit:15,offset:0})).preferredItem,undefined);
  assert.equal((await service.list({clientId:'pinned',search:'Other',limit:15,offset:0,spamScope:'SPAM'})).preferredItem.id,'pinned');
});

test('All counters describe the destination after channel and spam filters are cleared',async()=>{
 const rows=[{id:'a',inboxSpamAt:null,channel:'INSTAGRAM',status:'LEAD'},{id:'b',inboxSpamAt:null,channel:'FACEBOOK',status:'ACTIVE'},{id:'c',inboxSpamAt:new Date(),channel:'INSTAGRAM',status:'LEAD'}];
 const matches=(row,where)=> (!('inboxSpamAt' in where)||(where.inboxSpamAt===null?!row.inboxSpamAt:Boolean(row.inboxSpamAt)))&&(!where.status||row.status!==where.status.not)&&(!where.conversations?.some?.channel||(typeof where.conversations.some.channel==='string'?row.channel===where.conversations.some.channel:where.conversations.some.channel.in.includes(row.channel)))&&(!where.conversations?.some?.unreadCount)&&(!where.id?.in||where.id.in.includes(row.id));
 const db={client:{findMany:async()=>[],count:async({where})=>rows.filter(row=>matches(row,where)).length},$queryRaw:async()=>[],appSetting:{findMany:async()=>[]}};
 const result=await new CommunicationsService(db,{}).list({channels:['INSTAGRAM'],limit:15,offset:0});
 assert.equal(result.total,1);assert.equal(result.scopeCounts.allChannels,2);assert.equal(result.scopeCounts.normalAll,1);
 const spam=await new CommunicationsService(db,{}).list({channels:['INSTAGRAM'],spamScope:'SPAM',limit:15,offset:0});
 assert.equal(spam.scopeCounts.normalAll,1);assert.equal(spam.scopeCounts.allChannels,1);
});

test('aggregate timestamp excludes drafts but retains them in the detail window',async()=>{
 const db={client:{findFirst:async()=>({id:'a',source:'INSTAGRAM'})},conversation:{findMany:async()=>[{id:'c',unreadCount:0}]}};
 const service=new CommunicationsService(db,{});
 service.latestVisibleMessages=async()=>[
 {id:'real',direction:'INBOUND',status:'RECEIVED',messageType:'text',receivedAt:new Date('2026-10-15T12:00:00Z'),createdAt:new Date('2026-10-15T11:00:00Z')},
 {id:'draft',direction:'OUTBOUND',status:'DRAFT',createdAt:new Date('2026-10-15T13:00:00Z')}
 ];
 const result=await service.detail('a');
 assert.equal(result.messages.length,2);assert.equal(result.lastMessageAt.toISOString(),'2026-10-15T12:00:00.000Z');
});
