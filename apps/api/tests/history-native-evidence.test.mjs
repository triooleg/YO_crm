import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';

const {qualifyNativeHistoryBaseline,archiveCutoffExclusive,nativeMessageFingerprint,MAX_NATIVE_PROVIDER_OBSERVATION_AGE_MS}=loadTargetModule('history-migration/history-native-evidence.ts');
const receiver='900000000001',customer='800000000001';
const at=value=>new Date(value);
function snapshot(){
 const timestamp='2024-01-02T10:00:00.000Z';
 const payload={provider:'META',channel:'INSTAGRAM',externalSenderId:customer,externalMessageId:'mid.native-1',content:'Synthetic inbound',receiverId:receiver,receivedAt:timestamp,originalTimestamp:timestamp,metadata:{messageType:'text'}};
 return {
  client:{id:'canonical-client',instagram:customer,instagramUsername:'synthetic_athlete',archivedAt:null},receiverId:receiver,
  archive:[{source:'KEYCRM',account:'synthetic.keycrm.test',channel:'INSTAGRAM',dialogueId:'synthetic-thread',sourceMessageId:'archive-1',sender:'contact:synthetic-thread',direction:'INBOUND',text:'Synthetic archive',timestamp:'2024-01-01',sourceTimeText:'2024-01-01 12:30',sourceTimezone:'Europe/Kyiv',ordinal:0,attachments:[]}],
  conversations:[{id:'native-chat',clientId:'canonical-client',channel:'INSTAGRAM',externalId:receiver+':'+customer,archivedAt:null}],
  messages:[{id:'native-1',conversationId:'native-chat',direction:'INBOUND',status:'RECEIVED',content:'Synthetic inbound',normalizedText:'Synthetic inbound',messageType:'text',externalId:'mid.native-1',metadata:{source:'META',receiverId:receiver,messageType:'text'},rawPayload:structuredClone(payload),webhookEnvelopeId:'envelope-1',receivedAt:at(timestamp),sentAt:null,createdAt:at(timestamp),authorId:null}],
  envelopes:[{id:'envelope-1',provider:'META',payload,payloadHash:'a'.repeat(64),receivedAt:at(timestamp)}],
  deliveryAttempts:[],origins:[],attachments:[],
 };
}
function observation(input){
 const message=input.messages[0],time=message.direction==='OUTBOUND'?message.sentAt:message.receivedAt;
 return {messageId:message.id,provider:'META_GRAPH_INSTAGRAM',receiverId:receiver,customerId:customer,observedAt:new Date().toISOString(),
  body:{id:message.externalId,created_time:time.toISOString().slice(0,19)+'+0000',
   from:{id:message.direction==='OUTBOUND'?receiver:customer},to:{data:[{id:message.direction==='OUTBOUND'?customer:receiver}]},message:message.content}};
}
function legacy(){
 const input=snapshot();delete input.envelopes[0].payload.originalTimestamp;input.messages[0].rawPayload=structuredClone(input.envelopes[0].payload);return input;
}
function outbound(){
 const input=snapshot(),message=input.messages[0];
 Object.assign(message,{direction:'OUTBOUND',status:'SENT',content:'Synthetic CRM reply',normalizedText:null,metadata:{provider:'META',source:'CRM',receiverId:receiver,recipientId:customer},rawPayload:null,webhookEnvelopeId:null,receivedAt:null,sentAt:message.createdAt,createdAt:at('2023-12-31T09:00:00Z'),authorId:'synthetic-staff'});
 input.envelopes=[];
 input.deliveryAttempts=[{id:'attempt-1',clientRequestId:'synthetic-request-1',clientId:input.client.id,conversationId:'native-chat',messageId:message.id,status:'SENT',createdAt:at('2024-01-02T09:59:59Z'),updatedAt:at('2024-01-02T10:00:01Z')}];
 input.providerObservations=[observation(input)];
 return input;
}

test('qualifies actual scoped META replay evidence after the entire last archive minute, without aliases or mutations',()=>{
 const input=snapshot(),before=structuredClone(input),result=qualifyNativeHistoryBaseline(input);
 assert.equal(result.status,'QUALIFIED');
 assert.equal(result.archiveEndExclusive,'2024-01-01T10:31:00.000Z');
 assert.deepEqual(result.validatedMessageIds,['native-1']);
 assert.deepEqual(result.blockers,[]);
 assert.match(result.fingerprint,/^[a-f0-9]{64}$/);
 assert.equal('origins' in result,false);assert.equal('existing' in result,false);
 assert.deepEqual(input,before);
});

test('qualifies a real linked SENT delivery receipt with scoped CRM metadata and original sent time, including an older draft',()=>{
 const input=outbound(),before=structuredClone(input),result=qualifyNativeHistoryBaseline(input);
 assert.equal(result.status,'QUALIFIED');assert.deepEqual(result.validatedMessageIds,['native-1']);
 assert.deepEqual(result.blockers,[]);assert.deepEqual(input,before);
});

test('last-minute boundaries are exclusive of archive but inclusive of the next minute',()=>{
 for(const [time,status] of [['2024-01-01T10:30:00Z','REVIEW'],['2024-01-01T10:30:59.999Z','REVIEW'],['2024-01-01T10:31:00Z','QUALIFIED']]){
  const input=snapshot(),message=input.messages[0],payload=input.envelopes[0].payload;
  message.createdAt=message.receivedAt=at(time);input.envelopes[0].receivedAt=at(time);payload.receivedAt=time;payload.originalTimestamp=at(time).toISOString();message.rawPayload=structuredClone(payload);
  assert.equal(qualifyNativeHistoryBaseline(input).status,status,time);
 }
});

test('stored JSONB key order and the old noncanonical hash receipt never invent a mismatch',()=>{
 const input=snapshot(),expected=qualifyNativeHistoryBaseline(input);
 input.envelopes[0].payload=Object.fromEntries(Object.entries(input.envelopes[0].payload).reverse());
 input.messages[0].rawPayload=Object.fromEntries(Object.entries(input.messages[0].rawPayload).sort());
 const result=qualifyNativeHistoryBaseline(input);assert.equal(result.status,'QUALIFIED');assert.equal(result.fingerprint,expected.fingerprint);
 input.messages[0].rawPayload.content='Changed semantic content';
 assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW');
});

test('all native row orderings of the same transaction snapshot have the same fingerprint',()=>{
 const input=snapshot(),reply=outbound();reply.messages[0].id='reply';reply.deliveryAttempts[0].messageId='reply';reply.messages[0].externalId='mid.reply';
 input.messages.push(reply.messages[0]);input.deliveryAttempts=reply.deliveryAttempts;
 input.providerObservations=[{...reply.providerObservations[0],messageId:'reply',body:{...reply.providerObservations[0].body,id:'mid.reply'}}];
 const expected=qualifyNativeHistoryBaseline(input);assert.equal(expected.status,'QUALIFIED');
 input.messages.reverse();assert.equal(qualifyNativeHistoryBaseline(input).fingerprint,expected.fingerprint);
});

test('malformed calendar timestamps cannot become invented provider times through Date rollover',()=>{
 const input=snapshot(),invalid='2024-02-31T10:00:00Z';
 input.messages[0].createdAt=input.messages[0].receivedAt=at('2024-03-02T10:00:00Z');input.envelopes[0].receivedAt=at('2024-03-02T10:00:00Z');
 input.envelopes[0].payload.receivedAt=invalid;input.messages[0].rawPayload=structuredClone(input.envelopes[0].payload);
 assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW');
});

test('server cutoff helper derives the next whole minute, refusing unknown or nonarchive time',()=>{
 const input=snapshot();assert.equal(archiveCutoffExclusive(input.archive),'2024-01-01T10:31:00.000Z');
 for(const archive of [[],[{...input.archive[0],sourceTimeText:null}],[{...input.archive[0],source:'INSTAGRAM'}]]){
  assert.throws(()=>archiveCutoffExclusive(archive),/ARCHIVE_WINDOW_UNVERIFIED/);
 }
});

test('server context binds the exact message bytes and never relaxes the default projector',()=>{
 const input=snapshot(),result=qualifyNativeHistoryBaseline(input);
 assert.equal(result.messageFingerprints['native-1'],nativeMessageFingerprint(input.messages[0]));
 input.messages[0].content='Changed after qualification';
 assert.notEqual(result.messageFingerprints['native-1'],nativeMessageFingerprint(input.messages[0]));
 const {projectExistingHistory}=loadTargetModule('history-migration/history-planning-model.ts');
 const strict=projectExistingHistory({conversations:input.conversations,messages:input.messages,origins:[],attachments:[]});
 assert.equal(strict.unverifiedCount,1);assert.ok(strict.blockers.includes('UNVERIFIED_EXISTING_PROVENANCE'));
});

test('mixed archive origins are retained for strict projection, never relabelled as native',()=>{
 const input=snapshot(),archived={...structuredClone(input.messages[0]),id:'archive-row',externalId:null,metadata:{historyArchive:{policy:'KEYCRM_SOURCE_ARCHIVE_V1'}},rawPayload:null,webhookEnvelopeId:null,createdAt:at('2024-01-01T10:30:00Z'),receivedAt:at('2024-01-01T10:30:00Z')};
 input.messages.push(archived);input.origins=[{id:'origin-row',messageId:archived.id,runId:'archive-run',payloadEncrypted:'opaque-synthetic-ciphertext',status:'APPLIED'}];
 const before=structuredClone(input),result=qualifyNativeHistoryBaseline(input);
 assert.equal(result.status,'QUALIFIED');assert.deepEqual(result.validatedMessageIds,['native-1']);
 assert.deepEqual(Object.keys(result.messageFingerprints),['native-1']);assert.deepEqual(input,before);
});

test('all scope, state, content and envelope disagreements require review without leaking content',()=>{
 const cases={
  receiver:x=>{x.receiverId='900000000002';},client:x=>{x.conversations[0].clientId='other-client';},
  customer:x=>{x.client.instagram='800000000002';},username:x=>{x.client.instagramUsername=null;},archivedClient:x=>{x.client.archivedAt=at('2024-01-01');},
  archivedConversation:x=>{x.conversations[0].archivedAt=at('2024-01-01');},legacyScope:x=>{x.conversations[0].externalId=customer;},
  wrongChannel:x=>{x.conversations[0].channel='FACEBOOK';},metadataReceiver:x=>{x.messages[0].metadata.receiverId='other';},
  envelopeProvider:x=>{x.envelopes[0].provider='CHATWOOT';},envelopeId:x=>{x.messages[0].webhookEnvelopeId='missing';},
  envelopeReceipt:x=>{x.envelopes[0].payloadHash='not-a-hash';},envelopeTime:x=>{x.envelopes[0].receivedAt=at('2024-01-03');},
  sender:x=>{x.envelopes[0].payload.externalSenderId='other';x.messages[0].rawPayload=structuredClone(x.envelopes[0].payload);},
  content:x=>{x.messages[0].content='Changed stored text';},externalId:x=>{x.messages[0].externalId='mid.other';},
  missingTime:x=>{x.messages[0].receivedAt=null;},createdTime:x=>{x.messages[0].createdAt=at('2024-01-03');},
  unknownStatus:x=>{x.messages[0].status='DRAFT';},direction:x=>{x.messages[0].direction='INTERNAL';},
  normalizedText:x=>{x.messages[0].normalizedText='Changed normalized text';},
  sourceFlag:x=>{x.messages[0].metadata.source='YO_HISTORY_PILOT';},deletion:x=>{x.messages[0].metadata.deletion={deletedAt:'2024-01-03'};},
  dedup:x=>{x.messages[0].metadata.deduplicatedIntoMessageId='other';},
  fabricatedVerified:x=>{x.verified=true;x.messages[0].metadata.verified=true;x.envelopes=[];},
  duplicateEnvelope:x=>{x.envelopes.push(structuredClone(x.envelopes[0]));},duplicateMessage:x=>{x.messages.push(structuredClone(x.messages[0]));},
 };
 for(const [name,mutate] of Object.entries(cases)){
  const input=snapshot();mutate(input);const result=qualifyNativeHistoryBaseline(input);
  assert.equal(result.status,'REVIEW',name);assert.deepEqual(result.validatedMessageIds,[],name);assert.ok(result.blockers.length,name);
  assert.ok(!JSON.stringify(result.blockers).includes('Synthetic inbound'),name);
 }
});

test('delivery attempts must be unique scoped successful receipts, never an outbound metadata assertion alone',()=>{
 const cases={missing:x=>{x.deliveryAttempts=[];},uncertain:x=>{x.deliveryAttempts[0].status='UNCERTAIN';},failed:x=>{x.deliveryAttempts[0].status='FAILED';},
  client:x=>{x.deliveryAttempts[0].clientId='other';},conversation:x=>{x.deliveryAttempts[0].conversationId='other';},
  message:x=>{x.deliveryAttempts[0].messageId='other';},duplicate:x=>{x.deliveryAttempts.push(structuredClone(x.deliveryAttempts[0]));},
  request:x=>{x.deliveryAttempts[0].clientRequestId='';},time:x=>{x.deliveryAttempts[0].updatedAt=at('2024-01-01');},
  status:x=>{x.messages[0].status='FAILED';},recipient:x=>{x.messages[0].metadata.recipientId='other';},
  source:x=>{x.messages[0].metadata.source='META';},author:x=>{x.messages[0].authorId=null;},
  echoTime:x=>{x.messages[0].metadata.metaEchoReceivedAt='2024-01-03T10:00:00Z';},
 };
 for(const [name,mutate] of Object.entries(cases)){
  const input=outbound();mutate(input);const result=qualifyNativeHistoryBaseline(input);
  assert.equal(result.status,'REVIEW',name);assert.deepEqual(result.validatedMessageIds,[],name);
 }
});

test('wrapper IDs, fake archive metadata and unsupported echo evidence do not become native origins',()=>{
 for(const id of ['KEYCRM:thread:123','keycrm-123','history:row','["KEYCRM","source"]','engagement:reaction:123']){
  const input=snapshot();input.messages[0].externalId=id;input.envelopes[0].payload.externalMessageId=id;input.messages[0].rawPayload=structuredClone(input.envelopes[0].payload);
  assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW',id);
 }
 const input=snapshot();input.messages[0].metadata.historyArchive={policy:'KEYCRM_SOURCE_ARCHIVE_V1'};
 assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW');
 const echo=outbound();echo.messages[0].metadata.source='META';echo.deliveryAttempts=[];
 assert.equal(qualifyNativeHistoryBaseline(echo).status,'REVIEW');
});

test('malformed snapshot records and deep metadata fail closed as review',()=>{
 for(const property of ['messages','envelopes','conversations','origins','deliveryAttempts','attachments']){
  const input=snapshot();input[property]=[null];
  assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW',property);
 }
 const input=snapshot();input.messages[0].metadata.loop=input.messages[0].metadata;
 assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW');
});

test('unverified media inventory or edited normalized event metadata cannot hide inside a text row',()=>{
 for(const [base,change] of [
  [snapshot,x=>{x.messages[0].metadata.attachments=[{type:'image',url:'https://synthetic.invalid/absent'}];}],
  [snapshot,x=>{x.envelopes[0].payload.metadata.attachments=[{type:'image',url:'https://synthetic.invalid/absent'}];x.messages[0].rawPayload=structuredClone(x.envelopes[0].payload);}],
  [snapshot,x=>{x.envelopes[0].payload.metadata.replyTo={kind:'message',externalMessageId:'mid.quoted'};x.messages[0].rawPayload=structuredClone(x.envelopes[0].payload);}],
  [outbound,x=>{x.messages[0].metadata.attachments=[{type:'file',path:'unverified-native-file'}];}],
 ]){
  const input=base();change(input);assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW');
 }
});

test('missing original webhook time cannot be upgraded from normalizer arrival fallback',()=>{
 const {normalizeMetaWebhook}=loadTargetModule('communications/meta-webhook.ts');
 const raw={object:'instagram',entry:[{id:receiver,messaging:[{sender:{id:customer},recipient:{id:receiver},message:{mid:'mid.native-1',text:'Synthetic inbound'}}]}]};
 const [event]=normalizeMetaWebhook(raw);assert.ok(event);
 const input=snapshot(),message=input.messages[0];
 const payload=JSON.parse(JSON.stringify({provider:'META',...event,receivedAt:event.receivedAt.toISOString()}));
 message.createdAt=message.receivedAt=event.receivedAt;message.rawPayload=payload;
 input.envelopes[0].payload=structuredClone(payload);input.envelopes[0].receivedAt=event.receivedAt;
 const result=qualifyNativeHistoryBaseline(input);
 assert.equal(result.status,'REVIEW');assert.deepEqual(result.validatedMessageIds,[]);
});

test('legacy normalized-only inbound and outbound delivery receipts need independent original time',()=>{
 for(const input of [legacy(),outbound()]){
  input.providerObservations=[];const result=qualifyNativeHistoryBaseline(input);
  assert.equal(result.status,'REVIEW');assert.deepEqual(result.validatedMessageIds,[]);
 }
});

test('official scoped detail qualifies legacy millisecond rows at provider second precision without mutating evidence',()=>{
 for(const base of [legacy,outbound]){
  const input=base(),message=input.messages[0],time=at('2024-01-02T10:00:00.972Z');
  if(message.direction==='INBOUND'){
   message.receivedAt=message.createdAt=time;input.envelopes[0].receivedAt=time;input.envelopes[0].payload.receivedAt=time.toISOString();message.rawPayload=structuredClone(input.envelopes[0].payload);
  }else{message.sentAt=time;input.deliveryAttempts[0].updatedAt=at('2024-01-02T10:00:02Z');}
  input.providerObservations=[observation(input)];const before=structuredClone(input);
  const result=qualifyNativeHistoryBaseline(input);assert.equal(result.status,'QUALIFIED');assert.deepEqual(result.validatedMessageIds,['native-1']);assert.deepEqual(input,before);
 }
});

test('original canonical normalized milliseconds must exactly equal effective provider time',()=>{
 for(const value of [null,undefined,'2024-01-02T10:00:00Z','2024-01-02T10:00:00.001Z','2024-02-31T10:00:00.000Z',1704189600000]){
  const input=snapshot();input.envelopes[0].payload.originalTimestamp=value;
  if(value===undefined)delete input.envelopes[0].payload.originalTimestamp;
  input.messages[0].rawPayload=structuredClone(input.envelopes[0].payload);
  assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW',String(value));
 }
});

test('provider detail must exactly bind row, native MID, account, customer, text and unique directional participants',()=>{
 const changes={
  row:o=>{o.messageId='other';},provider:o=>{o.provider='UNTRUSTED';},receiver:o=>{o.receiverId='900000000002';},customer:o=>{o.customerId='800000000002';},
  mid:o=>{o.body.id='mid.other';},text:o=>{o.body.message='Edited';},from:o=>{o.body.from.id=receiver;},to:o=>{o.body.to.data[0].id=customer;},
  duplicateRecipient:o=>{o.body.to.data.push({...o.body.to.data[0]});},missingRecipient:o=>{o.body.to.data=[];},
 };
 for(const [name,change]of Object.entries(changes)){
  const input=legacy();input.providerObservations=[observation(input)];change(input.providerObservations[0]);
  assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW',name);
 }
 const input=outbound();input.providerObservations[0].body.from.id=customer;assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW');
});

test('Meta created_time validates calendar, UTC basic offset and second agreement',()=>{
 for(const value of ['2024-02-31T10:00:00+0000','2024-01-02T24:00:00+0000','2024-01-02T10:60:00+0000','2024-01-02T10:00:60+0000',
  '2024-01-02T10:00:00+0100','2024-01-02T10:00:00Z','2024-01-02T10:00:01+0000','2024-01-02T10:00:00.972+0000']){
  const input=legacy();input.providerObservations=[observation(input)];input.providerObservations[0].body.created_time=value;
  assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW',value);
 }
});

test('provider observations must be fresh, nonfuture and no earlier than original source time',()=>{
 const now=Date.now();
 for(const value of [new Date(now-MAX_NATIVE_PROVIDER_OBSERVATION_AGE_MS-1000).toISOString(),new Date(now+60000).toISOString(),
  '2023-01-01T00:00:00.000Z','2024-02-31T00:00:00.000Z','2024-01-02T10:01:00Z']){
  const input=legacy();input.providerObservations=[observation(input)];input.providerObservations[0].observedAt=value;
  assert.equal(qualifyNativeHistoryBaseline(input).status,'REVIEW',value);
 }
});

test('duplicate, excessive and unrelated observations never become verified context',()=>{
 for(const mode of ['duplicate','over-limit','unknown-row','origin-row','malformed']){
  const input=legacy(),proof=observation(input);input.providerObservations=[proof];
  if(mode==='duplicate')input.providerObservations.push(structuredClone(proof));
  if(mode==='over-limit')input.providerObservations=Array.from({length:21},()=>structuredClone(proof));
  if(mode==='unknown-row')proof.messageId='unrelated';
  if(mode==='origin-row')input.origins=[{messageId:'native-1'}];
  if(mode==='malformed')input.providerObservations=[null];
  const result=qualifyNativeHistoryBaseline(input);assert.equal(result.status,'REVIEW',mode);assert.deepEqual(result.validatedMessageIds,[],mode);
 }
});

test('fresh observedAt and volatile Graph names cannot invalidate identical preview/apply facts',()=>{
 const input=legacy();input.providerObservations=[observation(input)];input.providerObservations[0].observedAt=new Date(Date.now()-2000).toISOString();
 const before=qualifyNativeHistoryBaseline(input);assert.equal(before.status,'QUALIFIED');
 const proof=input.providerObservations[0];proof.observedAt=new Date().toISOString();proof.body.from.username='renamed';proof.body.from.name='Updated display';
 proof.body.to.data[0].username='other display';proof.body.to.paging={cursor:'volatile'};proof.body.optionalProviderField={unrelated:true};
 const after=qualifyNativeHistoryBaseline(input);assert.equal(after.status,'QUALIFIED');assert.equal(after.fingerprint,before.fingerprint);
 assert.deepEqual(after.messageFingerprints,before.messageFingerprints);
});

test('provider semantic changes alter plan identity and cannot qualify stale row facts',()=>{
 const input=legacy();input.providerObservations=[observation(input)];const before=qualifyNativeHistoryBaseline(input);
 for(const change of [p=>{p.body.message='Other text';},p=>{p.body.id='mid.other';},p=>{p.body.created_time='2024-01-02T10:00:01+0000';},p=>{p.body.from.id=receiver;}]){
  const next=structuredClone(input);change(next.providerObservations[0]);const result=qualifyNativeHistoryBaseline(next);
  assert.equal(result.status,'REVIEW');assert.notEqual(result.fingerprint,before.fingerprint);
 }
});

test('provider-derived original time uses the exclusive cutoff and never an inferred receipt timestamp',()=>{
 for(const [value,status]of [['2024-01-01T10:30:59.972Z','REVIEW'],['2024-01-01T10:31:00.972Z','QUALIFIED']]){
  const input=legacy(),time=at(value),message=input.messages[0];message.createdAt=message.receivedAt=time;input.envelopes[0].receivedAt=time;
  input.envelopes[0].payload.receivedAt=value;message.rawPayload=structuredClone(input.envelopes[0].payload);input.providerObservations=[observation(input)];
  assert.equal(qualifyNativeHistoryBaseline(input).status,status);
 }
});
