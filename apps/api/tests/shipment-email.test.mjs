import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './website-test-loader.mjs';
const {CommunicationsService}=loadTargetModule('communications/communications.service.ts');
const {shipmentEmailAccountIdentity}=loadTargetModule('communications/shipment-email-account.ts');
const sourceAccountIdentity=shipmentEmailAccountIdentity({username:'sender@example.org',fromAddress:'sender@example.org'});
const request={recipient:'order@example.org',subject:'Shipped',content:'Track your parcel',clientRequestId:'11111111-1111-4111-8111-111111111111',orderId:'order-1',shipmentId:'shipment-1',notificationId:'notification-1'};
function harness(deliver=async()=>({messageId:'<shipment-11111111-1111-4111-8111-111111111111@yoleotard.com>'})){
 const state={settings:[{section:'integration.email',key:'username',value:'sender@example.org'},{section:'integration.email',key:'fromAddress',value:'sender@example.org'}],attempts:[],messages:[],audits:[],activities:[],conversations:[{id:'conv-1',clientId:'client-1',channel:'EMAIL',externalId:'canonical@example.org',archivedAt:null}],sends:[]};
 const match=(row,where)=>Object.entries(where||{}).every(([key,value])=>value===undefined || (typeof value==='object'&&value!==null ? (value.in?value.in.includes(row[key]):value.not?row[key]!==value.not:true) : row[key]===value));
 const store=(rows,prefix)=>({findUniqueOrThrow:async({where})=>{const row=rows.find(row=>match(row,where));assert.ok(row);return row},findUnique:async({where})=>rows.find(row=>match(row,where.section_key||where.conversationId_externalId||where.clientId_channel||where))||null,findFirst:async({where})=>rows.find(row=>match(row,where))||null,findMany:async({where}={})=>rows.filter(row=>match(row,where)),count:async()=>0,create:async({data})=>{const row={id:prefix+rows.length,metadata:null,...data};rows.push(row);return row},update:async({where,data})=>{const row=rows.find(row=>match(row,where));assert.ok(row);Object.assign(row,data);return row},updateMany:async()=>({count:0}),deleteMany:async()=>({count:0}),upsert:async({where,create,update})=>{let row=rows.find(row=>match(row,where.section_key||where));if(row)Object.assign(row,update);else{row={id:prefix+rows.length,...create};rows.push(row)}return row}});
 const db={conversation:store(state.conversations,'conv-'),messageDeliveryAttempt:store(state.attempts,'attempt-'),message:store(state.messages,'message-'),appSetting:store(state.settings,'setting-'),auditLog:store(state.audits,'audit-'),activity:store(state.activities,'activity-'),webhookEnvelope:store([],'envelope-'),messageAttachment:store([],'attachment-'),communicationAttachment:store([],'upload-'),client:{findFirst:async()=>({id:'client-1',email:'canonical@example.org',archivedAt:null})},$executeRaw:async()=>0};db.$transaction=async callback=>callback(db);
 const transport={send:async input=>{state.sends.push(input);assert.equal(state.attempts[0].status,'PENDING');assert.equal(state.settings.find(row=>row.section==='integration.email.shipment-notification')?.key,input.messageId);return deliver(input)}};
 const service=new CommunicationsService(db,transport);service.shipmentChatwootAvailable=async()=>true;
 return {state,db,service};
}
test('shipment email uses explicit order recipient without rebinding and replays UUID without SMTP',async()=>{
 const {state,service}=harness();
 const first=await service.sendShipmentEmail('client-1',request,{id:'actor-1'});
 assert.equal(first.status,'SENT');assert.equal(state.messages.length,1);assert.equal(state.messages[0].status,'SENT');assert.equal(state.sends[0].to,'order@example.org');assert.equal(state.conversations[0].externalId,'canonical@example.org');
 assert.deepEqual(await service.sendShipmentEmail('client-1',request,{id:'actor-1'}),first);assert.equal(state.sends.length,1);
});
export {harness,request};
for(const channel of ['FACEBOOK','INSTAGRAM','WHATSAPP']){
 test(`${channel} shipment notification protects ambiguous network result and repeat`,async()=>{
  const {state,service}=harness();Object.assign(state.conversations[0],{channel,externalId:'page-1:person-1'});
  service.sectionValues=async()=>({enabled:true,pageId:'page-1',instagramAccountId:'page-1',whatsappPhoneNumberId:'page-1'});service.secretValue=()=> 'synthetic-token';
  const network=async()=>{throw new TypeError('network disconnected')};service.metaGraph=network;service.instagramGraph=network;service.whatsappGraph=network;
  await assert.rejects(()=>service.send('client-1',{action:'SEND',channel,content:'Shipped',clientRequestId:request.clientRequestId},{id:'actor-1'},{conversationId:'conv-1',externalId:'page-1:person-1'}));
  assert.equal(state.attempts[0]?.status,'UNCERTAIN');assert.equal(state.messages.length,0);
 });
}
const sentEvent=(recipient=request.recipient)=>({sourceAccountIdentity,externalMessageId:'<shipment-11111111-1111-4111-8111-111111111111@yoleotard.com>',recipient,content:request.content,sentAt:new Date('2026-10-27T12:00:00Z'),subject:request.subject,messageId:'<shipment-11111111-1111-4111-8111-111111111111@yoleotard.com>',references:[],rawPath:'synthetic.eml',attachments:[]});
test('Sent-first uses trusted order recipient even if address maps to another client; creates exactly one Message',async()=>{
 let service;const h=harness(async()=>{const event=sentEvent();assert.equal((await service.receiveSentEmailMessage(event,{synthetic:true})).accepted,true);return {messageId:event.externalMessageId}});service=h.service;
 h.state.conversations.push({id:'foreign-conv',clientId:'foreign-client',channel:'EMAIL',externalId:request.recipient,archivedAt:null});
 const result=await service.sendShipmentEmail('client-1',request,{id:'actor-1'});
 assert.equal(result.status,'SENT');assert.equal(h.state.messages.length,1);assert.equal(h.state.messages[0].conversationId,'conv-1');assert.equal(h.state.messages[0].metadata.source,'CRM');assert.ok(h.state.messages[0].webhookEnvelopeId);
 await service.receiveSentEmailMessage(sentEvent(),{synthetic:true});assert.equal(h.state.messages.length,1);
});
test('unknown SMTP result becomes UNCERTAIN, replay protected, Sent reconciles to SENT',async()=>{
 const h=harness(async()=>{throw new TypeError('network timeout')});
 assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'UNCERTAIN');assert.equal(h.state.messages.length,0);
 assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'UNCERTAIN');assert.equal(h.state.sends.length,1);
 await h.service.receiveSentEmailMessage(sentEvent(),{synthetic:true});
 assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'SENT');assert.equal(h.state.messages.length,1);
});
test('known shipment RFC ID with wrong recipient is rejected before ordinary recipient routing',async()=>{
 const h=harness(async()=>{throw new Error('network timeout')});await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'});
 h.state.conversations.push({id:'foreign-conv',clientId:'foreign-client',channel:'EMAIL',externalId:'wrong@example.org',archivedAt:null});
 assert.equal((await h.service.receiveSentEmailMessage(sentEvent('wrong@example.org'),{})).accepted,false);assert.equal(h.state.messages.length,0);
 h.state.settings.find(row=>row.section==='integration.email.shipment-notification').value.clientId='foreign-client';
 assert.equal((await h.service.receiveSentEmailMessage(sentEvent(),{})).accepted,false);assert.equal(h.state.messages.length,0);
});
test('crash after durable reservation retains PENDING protection; no draft exists',async()=>{
 let h;h=harness(async()=>{assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'PENDING');throw new Error('disconnect')});
 await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'});assert.equal(h.state.sends.length,1);assert.equal(h.state.messages.length,0);
});
test('definitive SMTP rejection stores FAILED and never resends same UUID',async()=>{
 const {BadGatewayException}=await import('@nestjs/common'); // Same runtime constructor loaded by the service.
 const h=harness(async()=>{throw new BadGatewayException('Gmail отклонил исходящее письмо')});
 const first=await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'});assert.equal(first.status,'FAILED');assert.equal(h.state.messages[0].status,'FAILED');
 assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'FAILED');assert.equal(h.state.sends.length,1);
});
test('missing canonical EMAIL conversation creates unbound conversation without changing client email',async()=>{
 const h=harness();h.state.conversations.length=0;
 assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'SENT');assert.equal(h.state.conversations[0].externalId,null);
});
test('same UUID with changed shipment, content, recipient or client is rejected',async()=>{
 const h=harness();await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'});
 for(const patch of [{shipmentId:'other'},{content:'other'},{recipient:'other@example.org'}])await assert.rejects(()=>h.service.sendShipmentEmail('client-1',{...request,...patch},{id:'actor-1'}));
 await assert.rejects(()=>h.service.sendShipmentEmail('client-2',request,{id:'actor-1'}));assert.equal(h.state.sends.length,1);
});
for(const patch of [{clientRequestId:'not-uuid'},{recipient:'victim@example.org\r\nBcc:other@example.org'},{subject:'ship\r\nBcc:other@example.org'},{content:''}])test(`rejects invalid shipment input ${Object.keys(patch)[0]}`,async()=>{
 const h=harness();await assert.rejects(()=>h.service.sendShipmentEmail('client-1',{...request,...patch},{id:'actor-1'}));assert.equal(h.state.sends.length,0);assert.equal(h.state.attempts.length,0);
});
for(const channel of ['FACEBOOK','INSTAGRAM','WHATSAPP'])for(const outcome of ['missing-id','persistence-failure','rejection','ordinary-network'])test(`${channel} ${outcome} respects notification-only uncertainty policy`,async()=>{
 const {MetaGraphRequestError,metaSendFailure}=loadTargetModule('communications/meta-send.ts');
 const h=harness();Object.assign(h.state.conversations[0],{channel,externalId:'page-1:person-1'});
 h.service.sectionValues=async()=>({enabled:true,pageId:'page-1',instagramAccountId:'page-1',whatsappPhoneNumberId:'page-1'});h.service.secretValue=()=> 'synthetic-token';
 const provider=async()=>{if(outcome==='rejection')throw new MetaGraphRequestError(metaSendFailure({code:10}));if(outcome==='ordinary-network')throw new TypeError('network disconnected');return outcome==='missing-id'?{}:channel==='WHATSAPP'?{messages:[{id:'provider-mid'}]}:{message_id:'provider-mid'}};
 h.service.metaGraph=provider;h.service.instagramGraph=provider;h.service.whatsappGraph=provider;
 if(outcome==='persistence-failure')h.db.message.upsert=h.db.message.create=async()=>{throw new Error('database unavailable')};
 const call=()=>h.service.send('client-1',{action:'SEND',channel,content:'Shipped',clientRequestId:request.clientRequestId},{id:'actor-1'},outcome==='ordinary-network'?undefined:{conversationId:'conv-1',externalId:'page-1:person-1'});
 if(outcome==='rejection'||outcome==='ordinary-network')assert.equal((await call()).status,'FAILED');else await assert.rejects(call);
 assert.equal(h.state.attempts[0].status,outcome==='rejection'||outcome==='ordinary-network'?'FAILED':'UNCERTAIN');
});
for(const channel of ['FACEBOOK','INSTAGRAM','WHATSAPP','CHATWOOT'])test(`${channel} changed notification conversation rejected before reservation`,async()=>{
 const h=harness();Object.assign(h.state.conversations[0],{channel,externalId:'page-1:person-1',messages:[{metadata:{chatwootConversationId:'123'}}]});
 h.service.sectionValues=async()=>({enabled:true,pageId:'page-1',instagramAccountId:'page-1',whatsappPhoneNumberId:'page-1',accountId:'1',baseUrl:'https://chatwoot.example.org'});h.service.secretValue=()=> 'synthetic-token';
 await assert.rejects(()=>h.service.send('client-1',{action:'SEND',channel,content:'Shipped',clientRequestId:request.clientRequestId},{id:'actor-1'},{conversationId:'conv-1',externalId:'changed'}));assert.equal(h.state.attempts.length,0);
});
test('empty provider error envelope is ambiguous for notification',async()=>{
 const {MetaGraphRequestError,metaSendFailure}=loadTargetModule('communications/meta-send.ts');const h=harness();Object.assign(h.state.conversations[0],{channel:'FACEBOOK',externalId:'page-1:person-1'});
 h.service.sectionValues=async()=>({enabled:true,pageId:'page-1'});h.service.secretValue=()=> 'synthetic-token';h.service.metaGraph=async()=>{throw new MetaGraphRequestError(metaSendFailure(undefined))};
 await assert.rejects(()=>h.service.send('client-1',{action:'SEND',channel:'FACEBOOK',content:'Shipped',clientRequestId:request.clientRequestId},{id:'actor-1'},{conversationId:'conv-1',externalId:'page-1:person-1'}));assert.equal(h.state.attempts[0].status,'UNCERTAIN');
});
test('Sent-first retains original administrator author and trusted order attribution',async()=>{
 let h;h=harness(async()=>{await h.service.receiveSentEmailMessage(sentEvent(),{});return {messageId:sentEvent().externalMessageId}});
 await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'});assert.equal(h.state.messages[0].authorId,'actor-1');assert.equal(h.state.messages[0].metadata.orderId,'order-1');
});
test('SMTP success with unexpected Message-ID remains uncertain until trusted Sent confirmation',async()=>{
 const h=harness(async()=>({messageId:'<unexpected@example.org>'}));assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'UNCERTAIN');assert.equal(h.state.messages.length,0);
});
test('late Sent confirmation after manual failure updates both Message and authoritative attempt',async()=>{
 const h=harness(async()=>{throw new TypeError('network timeout')});await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'});h.state.attempts[0].status='FAILED';
 await h.service.receiveSentEmailMessage(sentEvent(),{});assert.equal(h.state.attempts[0].status,'SENT');assert.equal(h.state.messages.length,1);
});
test('durable PENDING survives failed uncertainty persistence and blocks even a stale replay',async()=>{
 const h=harness();const transaction=h.db.$transaction;
 h.service.emailTransport.send=async()=>{h.state.sends.push({});h.db.$transaction=async()=>{throw new Error('database unavailable')};throw new TypeError('connection lost')};
 const first=await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'});assert.equal(first.status,'PENDING');h.db.$transaction=transaction;h.state.attempts[0].updatedAt=new Date('2020-01-01T00:00:00Z');
 assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'PENDING');assert.equal(h.state.sends.length,1);assert.equal(h.state.messages.length,0);
});
test('SMTP accepted then message persistence failed enters existing email uncertainty recovery',async()=>{
 const h=harness(),create=h.db.message.create;h.db.message.create=async()=>{throw new Error('database unavailable')};
 assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'UNCERTAIN');h.db.message.create=create;
 assert.ok(h.state.settings.some(row=>row.section==='integration.email.delivery-uncertain'));
 await h.service.receiveSentEmailMessage(sentEvent(),{});assert.equal(h.state.attempts[0].status,'SENT');assert.equal(h.state.messages.length,1);
});
test('Sent-first proof wins over a later SMTP timeout',async()=>{
 let h;h=harness(async()=>{await h.service.receiveSentEmailMessage(sentEvent(),{});throw new TypeError('SMTP timeout after acceptance')});
 assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'SENT');assert.equal(h.state.messages.length,1);
});
test('notification reservation rejects a provider-recipient snapshot different from approved context even if current row matches',async()=>{
 const h=harness();Object.assign(h.state.conversations[0],{channel:'FACEBOOK',externalId:'page-1:approved'});
 h.db.conversation.findFirst=async()=>({...h.state.conversations[0],externalId:'page-1:stale'});
 h.service.sectionValues=async()=>({enabled:true,pageId:'page-1'});h.service.secretValue=()=> 'synthetic-token';h.service.metaGraph=async()=>({message_id:'would-send-to-stale'});
 await assert.rejects(()=>h.service.send('client-1',{action:'SEND',channel:'FACEBOOK',content:'Shipped',clientRequestId:request.clientRequestId},{id:'actor-1'},{conversationId:'conv-1',externalId:'page-1:approved'}));assert.equal(h.state.attempts.length,0);
});
for(const channel of ['FACEBOOK','INSTAGRAM','WHATSAPP'])test(`${channel} notification returns raw successful Message and replay never calls provider twice`,async()=>{
 const h=harness();Object.assign(h.state.conversations[0],{channel,externalId:'page-1:person-1'});
 h.service.sectionValues=async()=>({enabled:true,pageId:'page-1',instagramAccountId:'page-1',whatsappPhoneNumberId:'page-1'});h.service.secretValue=()=> 'synthetic-token';let calls=0;
 const provider=async()=>{calls++;return channel==='WHATSAPP'?{messages:[{id:'provider-mid'}]}:{message_id:'provider-mid'}};h.service.metaGraph=provider;h.service.instagramGraph=provider;h.service.whatsappGraph=provider;
 const send=()=>h.service.send('client-1',{action:'SEND',channel,content:'Shipped',clientRequestId:request.clientRequestId},{id:'actor-1'},{conversationId:'conv-1',externalId:'page-1:person-1'});
 const first=await send();assert.equal(first.status,'SENT');assert.equal(first.externalId,'provider-mid');assert.equal(first.content,'Shipped');assert.equal(h.state.attempts[0].status,'SENT');assert.equal((await send()).id,first.id);assert.equal(calls,1);
});
for(const outcome of ['timeout','missing-id','persistence-failure'])test(`Chatwoot shipment ${outcome} never persists definitive FAILED`,async()=>{
 const h=harness();Object.assign(h.state.conversations[0],{channel:'CHATWOOT',externalId:null,messages:[{metadata:{chatwootConversationId:'123'}}]});
 h.service.sectionValues=async()=>({enabled:true,accountId:'1',baseUrl:'https://chatwoot.example.org'});h.service.secretValue=()=> 'synthetic-token';h.service.sendChatwootProviderMessage=async()=>{if(outcome==='timeout'||outcome==='missing-id')throw new Error('ambiguous provider response');return {id:'cw-mid'}};
 if(outcome==='persistence-failure')h.db.message.upsert=h.db.message.create=async()=>{throw new Error('database unavailable')};
 await assert.rejects(()=>h.service.sendShipmentChat('client-1',{conversationId:'conv-1',externalId:null,channel:'CHATWOOT',content:'Shipped',clientRequestId:request.clientRequestId},{id:'actor-1'}));assert.equal(h.state.attempts[0]?.status,'UNCERTAIN');
});
test('shipment email context rejects a different connected Gmail account on Sent reconciliation and replay',async()=>{
 const h=harness(async()=>{throw new Error('timeout')});await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'});
 h.state.settings.find(row=>row.section==='integration.email'&&row.key==='username').value='other-account@example.org';
 assert.equal((await h.service.receiveSentEmailMessage(sentEvent(),{})).accepted,false);assert.equal(h.state.messages.length,0);
 await assert.rejects(()=>h.service.sendShipmentEmail('client-1',request,{id:'actor-1'}));assert.equal(h.state.sends.length,1);
});
for(const outcome of ['timeout','missing-id','server-error','rejection','success','ordinary-timeout'])test(`real Chatwoot adapter classifies ${outcome} using safe provider evidence`,async()=>{
 const h=harness();Object.assign(h.state.conversations[0],{channel:'CHATWOOT',externalId:null,messages:[{metadata:{chatwootConversationId:'123'}}]});h.service.sectionValues=async()=>({enabled:true,accountId:'1',baseUrl:'https://chatwoot.example.org'});h.service.secretValue=()=> 'synthetic-token';
 const original=globalThis.fetch;globalThis.fetch=async()=>{if(outcome==='timeout'||outcome==='ordinary-timeout')throw new TypeError('synthetic timeout');return new Response(JSON.stringify(outcome==='success'?{id:123}:outcome==='rejection'?{error:'raw-provider-detail-never-persist'}:{}),{status:outcome==='rejection'?422:outcome==='server-error'?500:200,headers:{'Content-Type':'application/json'}})};
 try{
 const call=()=>outcome==='ordinary-timeout'?h.service.send('client-1',{action:'SEND',channel:'CHATWOOT',content:'Shipped',clientRequestId:request.clientRequestId},{id:'actor-1'}):h.service.sendShipmentChat('client-1',{conversationId:'conv-1',externalId:null,channel:'CHATWOOT',content:'Shipped',clientRequestId:request.clientRequestId},{id:'actor-1'});
 if(['success','rejection','ordinary-timeout'].includes(outcome))assert.equal((await call()).status,outcome==='success'?'SENT':'FAILED');else await assert.rejects(call);
 assert.equal(h.state.attempts[0].status,outcome==='success'?'SENT':['rejection','ordinary-timeout'].includes(outcome)?'FAILED':'UNCERTAIN');assert.equal(JSON.stringify(h.state).includes('raw-provider-detail-never-persist'),false);
 }finally{globalThis.fetch=original}
});

for (const source of [undefined,'another-mailbox-snapshot']) test(`shipment Sent reconciliation rejects absent or different IMAP account snapshot: ${source}`,async()=>{
 const h=harness(async()=>{throw new TypeError('network timeout')});
 await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'});
 assert.equal((await h.service.receiveSentEmailMessage({...sentEvent(),sourceAccountIdentity:source},{})).accepted,false);
 assert.equal(h.state.attempts[0].status,'UNCERTAIN'); assert.equal(h.state.messages.length,0);
});

test('confirmed email mailbox identity cannot be recaptured from changed settings during adapter reservation',async()=>{
 const h=harness();
 await assert.rejects(h.service.sendShipmentEmail('client-1',{...request,accountIdentity:'previous-confirmed-mailbox'},{id:'actor-1'}),/аккаунт изменился/);
 assert.equal(h.state.attempts.length,0);assert.equal(h.state.sends.length,0);
});
test('definitive failed shipment email preserves conversation chronology',async()=>{
 const {BadGatewayException}=await import('@nestjs/common');
 const h=harness(async()=>{throw new BadGatewayException('Gmail отклонил исходящее письмо')});
 const statements=[];h.db.$executeRaw=async(strings)=>{statements.push(strings.join(''));return 0};
 assert.equal((await h.service.sendShipmentEmail('client-1',request,{id:'actor-1'})).status,'FAILED');
 assert.equal(statements.some(sql=>sql.includes('UPDATE "Conversation"')),false);
});
