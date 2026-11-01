import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {readQualifiedNativeProjection}=loadTargetModule('history-migration/history-native-projection.ts');
const {projectExistingHistory}=loadTargetModule('history-migration/history-planning-model.ts');
const {encryptSecret}=loadTargetModule('secret-box.ts');
process.env.SETTINGS_ENCRYPTION_KEY='synthetic-native-projection-test-only-key';
function fixture(){
 const time=new Date('2024-01-02T10:00:00Z'),account='900000000001',customer='800000000001';
 const payload={provider:'META',channel:'INSTAGRAM',externalSenderId:customer,externalMessageId:'mid.native',content:'Synthetic',receiverId:account,receivedAt:time.toISOString(),metadata:{messageType:'text'}};
 const history={conversations:[{id:'chat',clientId:'client',channel:'INSTAGRAM',externalId:account+':'+customer,archivedAt:null}],messages:[{id:'message',conversationId:'chat',direction:'INBOUND',status:'RECEIVED',content:'Synthetic',normalizedText:'Synthetic',messageType:'text',externalId:'mid.native',metadata:{source:'META',receiverId:account,messageType:'text'},rawPayload:payload,webhookEnvelopeId:'envelope',receivedAt:time,sentAt:null,createdAt:time,authorId:null}],origins:[],attachments:[]};
 const replies=[[{id:'client',instagram:customer,instagramUsername:'synthetic',archivedAt:null}],[{key:'instagramAccountId',value:account},{key:'instagramAccessTokenEncrypted',value:encryptSecret('synthetic-token')}],[{count:1,bytes:'1000'}],[{id:'envelope',provider:'META',payload,payloadHash:'a'.repeat(64),receivedAt:time}],[],[]];
 const calls=[];const db={$queryRaw:async(q,...v)=>{calls.push(q.join('?'));return replies.shift()}};
 const archive=[{source:'KEYCRM',account:'synthetic.keycrm.test',channel:'INSTAGRAM',dialogueId:'thread',sourceMessageId:'old',sender:'contact:thread',direction:'INBOUND',text:'Archive',timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv',ordinal:0,attachments:[]}];
 const transport=async()=>new Response(JSON.stringify({id:'mid.native',created_time:'2024-01-02T10:00:00+0000',from:{id:customer},to:{data:[{id:account}]},message:'Synthetic'}));
 return {history,db,replies,calls,archive,transport};
}
test('transaction-native projection qualifies later native rows without inventing source aliases or weakening default projection',async()=>{
 const f=fixture(),before=structuredClone(f.history);
 assert.equal(projectExistingHistory(f.history).unverifiedCount,1);
 const projected=await readQualifiedNativeProjection(f.db,f.history,f.archive,f.transport);
 assert.deepEqual(projected.existing,[]);assert.deepEqual(projected.blockers,[]);assert.equal(projected.unverifiedCount,0);
 assert.deepEqual(f.history,before);assert.notEqual(projected.fingerprint,projectExistingHistory(f.history).fingerprint);
});
test('native projection rejects wrong configured receiver, missing scope, bounded evidence overflow and edited evidence',async()=>{
 for(const mutate of [f=>f.replies[1][0].value='wrong',f=>f.history.conversations.push({...f.history.conversations[0],id:'other'}),f=>f.replies[2][0].bytes='33554433',f=>f.replies[3][0].payload.content='Edited']){
  const f=fixture();mutate(f);await assert.rejects(readQualifiedNativeProjection(f.db,f.history,f.archive,f.transport));
 }
});
test('a consistently normalized arrival fallback cannot outrank the official original date, scope, ID or text',async()=>{
 for(const patch of [{created_time:'2023-01-01T10:00:00+0000'},{from:{id:'foreign'}},{id:'wrong'},{message:'Different original'}]){
  const f=fixture(),body=await(await f.transport()).json();
  await assert.rejects(readQualifiedNativeProjection(f.db,f.history,f.archive,async()=>new Response(JSON.stringify({...body,...patch}))));
 }
});
