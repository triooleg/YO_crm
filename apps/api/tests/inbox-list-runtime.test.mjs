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
