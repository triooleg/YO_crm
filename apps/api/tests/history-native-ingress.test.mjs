import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {loadTargetModule} from './overview-target-loader.mjs';

const {CommunicationsService}=loadTargetModule('communications/communications.service.ts');
const {sealHistoryEvidence,openHistoryEvidence}=loadTargetModule('history-migration/history-evidence.ts');
const {encryptSecret}=loadTargetModule('secret-box.ts');
process.env.SETTINGS_ENCRYPTION_KEY='synthetic-history-ingress-test-key-only-000000';
process.env.AI_ENABLED='true';
process.env.AI_MESSAGE_ANALYSIS_ENABLED='true';
const cutoff='2024-01-01T12:31:00.000Z';
const old='2024-01-01T12:30:59.999Z';
const later='2024-01-01T12:31:00.000Z';
const raw=(direction='INBOUND',timestamp=old,mid='mid')=>({object:'instagram',entry:[{id:'receiver',messaging:[{
  sender:{id:direction==='INBOUND'?'customer':'receiver'},recipient:{id:direction==='INBOUND'?'receiver':'customer'},
  ...(timestamp===null?{}:{timestamp:Date.parse(timestamp)}),message:{mid,text:'Synthetic message',...(direction==='OUTBOUND'?{is_echo:true}:{})},
}]}]});
const event=(changes={})=>({channel:'INSTAGRAM',externalSenderId:'customer',externalMessageId:'mid',receiverId:'receiver',
  content:'Synthetic message',receivedAt:new Date('2099-01-01T00:00:00.000Z'),metadata:{messageType:'text'},...changes});
const echo=(changes={})=>{const {externalSenderId,...rest}=event();return {...rest,externalRecipientId:externalSenderId,...changes};};
const mirror=(changes={})=>event({externalMessageId:'chatwoot:7:9',receiverId:undefined,accountId:'7',inboxId:'8',...changes});

function fixture({protectedRun=true,window=true,status='APPLIED',legacy=false,conversationExternalId,duplicate=null,holdHistoryLock,failReview=false,failCommit=false,account='receiver'}={}){
  const convo={id:'conversation',clientId:'client',channel:'INSTAGRAM',externalId:conversationExternalId??(legacy?'customer':account+':customer'),
    archivedAt:null,lastMessageAt:null,unreadCount:0,unreadVersion:0};
  const client={id:'client',archivedAt:null,lastContactAt:null,displayName:'Synthetic client',email:null,phone:null,avatarUrl:null,city:null,country:null};
  const initial={conversation:convo,client,messages:duplicate?[{id:'native',conversationId:convo.id,externalId:'mid',metadata:{},...duplicate}]:[],reviews:[],envelopes:[],normalWrites:[],trace:[]};
  const p={state:structuredClone(initial)};
  const archive={version:1,conversationId:convo.id,channel:'INSTAGRAM',accountId:account,customerId:'customer',runId:'run',status,archiveStartAt:'2024-01-01T12:00:00.000Z',cutoffAt:cutoff};
  p.appSetting={upsert:async()=>({syntheticHeartbeat:true})};
  p.$transaction=async callback=>{
    if(Array.isArray(callback))return Promise.all(callback);
    const state=structuredClone(p.state);
    const write=(model,operation,input)=>{state.normalWrites.push([model,operation,structuredClone(input)]);return {id:model+'-'+state.normalWrites.length,...input.data};};
    const tx={
      async $executeRaw(strings,...values){
        const sql=strings.join('?');state.trace.push(['execute',sql,values]);
        if(sql.includes('pg_advisory_xact_lock_shared')&&String(values[0]).startsWith('history-conversation:')){
          if(holdHistoryLock)await holdHistoryLock();
          state.trace.push(['history-lock-acquired']);
        }
        if(sql.includes('INSERT INTO "WebhookEnvelope"'))state.envelopes.push({id:values[0],payload:values[1],payloadHash:values[2]});
        if(sql.includes('INSERT INTO "HistoryMigrationNativeReview"')){
          if(failReview)throw new Error('synthetic-review-failure');
          state.reviews.push({id:values[0],runId:values[1],conversationId:values[2],scopeKey:values[3],payloadHash:values[4],reason:values[5],payloadEncrypted:values[6],status:'PENDING'});
        }
        return 1;
      },
      async $queryRaw(strings,...values){
        const sql=strings.join('?');state.trace.push(['query',sql,values]);
        assert.ok(state.trace.some(row=>row[0]==='history-lock-acquired'),'binding/window read must hold the history lock');
        if(sql.includes('FROM "HistoryMigrationPilotRun"'))return protectedRun?[{id:'run',nativeConversationId:convo.id,nativeAccountId:account,nativeCustomerId:'customer',status}]:[];
        if(sql.includes('FROM "HistoryMigrationNativeWindow"'))return window?[{payloadEncrypted:window==='corrupt'?'corrupt':sealHistoryEvidence('NATIVE_WINDOW','run:conversation',archive)}]:[];
        if(sql.includes('FROM "HistoryMigrationNativeReview"'))return state.reviews.filter(row=>row.id===values[0]);
        throw new Error('unexpected SQL '+sql);
      },
      conversation:{
        async findUnique({where,include}){
          const scoped=where.externalId_channel;
          const match=where.id===convo.id||where.clientId_channel?.clientId===convo.clientId||scoped?.externalId===state.conversation.externalId;
          return match?{...state.conversation,...(include?{messages:[{metadata:{receiverId:'receiver'}}]}:{})}:null;
        },
        async findFirst(){return null;},
        async update(input){write('conversation','update',input);Object.assign(state.conversation,input.data);return {...state.conversation};},
        async upsert(input){write('conversation','upsert',input);Object.assign(state.conversation,input.update);return {...state.conversation};},
      },
      client:{
        async findUnique(){return {...state.client};},async findMany(){return [{...state.client}];},
        async update(input){write('client','update',input);Object.assign(state.client,input.data);return {...state.client};},
        async updateMany(input){write('client','updateMany',input);return {count:1};},
        async create(input){return write('client','create',input);},
      },
      clientMergeRedirect:{async findUnique(){return null;},async findMany(){return []; }},
      message:{
        async findUnique({where}){return state.messages.find(row=>row.externalId===where.conversationId_externalId.externalId)||null;},
        async create(input){const row=write('message','create',input);state.messages.push(row);return row;},
        async update(input){const row=state.messages.find(row=>row.id===input.where.id);write('message','update',input);Object.assign(row,input.data);return row;},
      },
      messageAttachment:{async count(){return 0;},async create(input){return write('attachment','create',input);}},
      webhookEnvelope:{async create(input){return write('envelope','create',input);}},
      aiJob:{async create(input){return write('aiJob','create',input);}},
      auditLog:{async create(input){return write('audit','create',input);}},
      activity:{async create(input){return write('activity','create',input);}},
    };
    const result=await callback(tx);
    if(failCommit)throw new Error('synthetic-commit-failure');
    p.state=state;return result;
  };
  const service=Object.create(CommunicationsService.prototype);service.p=p;service.logger={log(){},warn(){},error(){}};
  return {p,service,review:()=>p.state.reviews.map(row=>openHistoryEvidence('NATIVE_REVIEW',row.id,row.payloadEncrypted))};
}

test('actual inbound holds old native event for durable review without timeline/unread/AI/profile side effects',async()=>{
  const f=fixture();
  assert.equal(await f.service.persistInbound(event(),'META',{synthetic:'unchanged-replay-fragment'},raw()),false);
  assert.equal(f.review().length,1);
  assert.equal(f.review()[0].reason,'BEFORE_CUTOFF');
  assert.deepEqual(f.p.state.normalWrites,[]);
  assert.equal(f.p.state.envelopes.length,1);
});

test('actual Meta echo reviews an old unknown MID before creating or updating timeline rows',async()=>{
  const f=fixture();
  assert.equal(await f.service.persistMetaEcho(echo(),raw('OUTBOUND')),false);
  assert.equal(f.review()[0].reason,'BEFORE_CUTOFF');
  assert.deepEqual(f.p.state.normalWrites,[]);
});

test('actual Chatwoot Instagram outbound mirror cannot manufacture native account or original time',async()=>{
  const f=fixture({conversationExternalId:'customer'});
  assert.equal(await f.service.persistChatwootOutbound(mirror(),{synthetic:'mirror'}),false);
  assert.equal(f.review().length,1);
  const stored=JSON.parse(f.review()[0].eventJson);
  assert.equal(stored.provider,'CHATWOOT');assert.equal(stored.accountId,'');assert.equal(stored.originalTimestamp,null);
  assert.deepEqual(f.p.state.normalWrites,[]);
});

test('inbound legacy scope migration is deferred until the protected event passes guard',async()=>{
  const f=fixture({legacy:true});
  assert.equal(await f.service.persistInbound(event(),'META',{synthetic:true},raw()),false);
  assert.equal(f.review().length,1);assert.deepEqual(f.p.state.normalWrites,[]);
  assert.equal(f.p.state.conversation.externalId,'customer');
});

test('outbound legacy scope migration is also deferred until guard passes',async()=>{
  const f=fixture({legacy:true});
  assert.equal(await f.service.persistMetaEcho(echo(),raw('OUTBOUND')),false);
  assert.equal(f.review().length,1);assert.deepEqual(f.p.state.normalWrites,[]);
  assert.equal(f.p.state.conversation.externalId,'customer');
});

test('both Meta directions require original raw time; future receivedAt fallback never authorizes admission',async()=>{
  for(const direction of ['INBOUND','OUTBOUND'])for(const payload of [null,raw(direction,null)]){
    const f=fixture();
    assert.equal(direction==='INBOUND'
      ?await f.service.persistInbound(event(),'META',{receivedAt:later},payload)
      :await f.service.persistMetaEcho(echo(),payload),false);
    assert.equal(f.review()[0].reason,'UNKNOWN_ORIGINAL_TIME');assert.deepEqual(f.p.state.normalWrites,[]);
  }
});

test('historical replay without explicit original payload remains unknown even if its stored JSON looks like Meta entry',async()=>{
  const f=fixture();
  assert.equal(await f.service.persistInbound(event(),'META',raw('INBOUND',later)),false);
  assert.equal(f.review()[0].reason,'UNKNOWN_ORIGINAL_TIME');assert.deepEqual(f.p.state.normalWrites,[]);
});

test('late Meta originals pass both actual methods; inbound keeps its existing stored replay fragment',async()=>{
  const stored={provider:'META',receivedAt:'2099-01-01T00:00:00.000Z',synthetic:'existing-envelope-format'};
  const f=fixture();assert.equal(await f.service.persistInbound(event(),'META',stored,raw('INBOUND',later)),true);
  const created=f.p.state.normalWrites.find(([model,op])=>model==='message'&&op==='create')[2].data;
  assert.deepEqual(created.rawPayload,stored);
  assert.deepEqual(f.p.state.normalWrites.find(([model])=>model==='envelope')[2].data.payload,stored);
  assert.equal(f.review().length,0);assert.ok(f.p.state.normalWrites.some(([m])=>m==='aiJob'));
  const g=fixture();assert.equal(await g.service.persistMetaEcho(echo(),raw('OUTBOUND',later)),true);
  assert.equal(g.review().length,0);assert.equal(g.p.state.messages.length,1);
});

test('Instagram inbound mirror reaches guard also through client/contact match before client-channel upsert',async()=>{
  const f=fixture();
  assert.equal(await f.service.persistInbound(mirror({externalSenderId:'instagram-username:synthetic'}),'CHATWOOT',{accountId:'7'}),false);
  assert.equal(f.review().length,1);assert.deepEqual(f.p.state.normalWrites,[]);
  assert.equal(f.p.state.conversation.externalId,'receiver:customer');
});

test('exact inbound native-ID duplicate skips guard and all side effects even with missing window',async()=>{
  const f=fixture({duplicate:{},window:false});
  assert.equal(await f.service.persistInbound(event(),'META',{synthetic:true}),false);
  assert.equal(f.review().length,0);assert.deepEqual(f.p.state.normalWrites,[]);
  assert.ok(!f.p.state.trace.some(row=>row[0]==='query'));
});

test('known Meta native-ID echo preserves existing update/reconciliation then unchanged duplicate contract',async()=>{
  const f=fixture({duplicate:{metadata:{source:'CRM'}},window:false});
  assert.equal(await f.service.persistMetaEcho(echo()),true);
  assert.equal(f.p.state.messages.length,1);assert.equal(f.p.state.messages[0].id,'native');
  assert.equal(f.p.state.messages[0].metadata.source,'CRM');assert.equal(f.review().length,0);
  const prior=structuredClone(f.p.state.normalWrites);
  assert.equal(await f.service.persistMetaEcho(echo()),false);assert.deepEqual(f.p.state.normalWrites,prior);
});

test('known Chatwoot native-ID keeps metadata sync then exact payload duplicate remains unchanged',async()=>{
  const payload={synthetic:'mirror'};const mid='chatwoot:7:9';
  const f=fixture({conversationExternalId:'customer',duplicate:{externalId:mid},window:false});
  assert.equal(await f.service.persistChatwootOutbound(mirror(),payload),true);
  assert.equal(f.p.state.messages.length,1);assert.equal(f.review().length,0);
  const prior=structuredClone(f.p.state.normalWrites);
  assert.equal(await f.service.persistChatwootOutbound(mirror(),payload),false);assert.deepEqual(f.p.state.normalWrites,prior);
});

test('review retry is idempotent while conflicting payload variants are retained separately',async()=>{
  const f=fixture();const payload=raw();
  for(let n=0;n<2;n++)assert.equal(await f.service.persistInbound(event(),'META',{synthetic:true},payload),false);
  assert.equal(f.review().length,1);assert.equal(f.p.state.envelopes.length,1);
  const variant=structuredClone(payload);variant.entry[0].messaging[0].message.text='Synthetic variant';
  assert.equal(await f.service.persistInbound(event(),'META',{synthetic:true},variant),false);
  assert.equal(f.review().length,2);assert.equal(f.p.state.envelopes.length,2);assert.deepEqual(f.p.state.normalWrites,[]);
});

test('missing windows and rolled-back runs cannot bypass review when all feature flags are disabled',async()=>{
  const saved={...process.env};
  try{
    process.env.HISTORY_MIGRATION_ENABLED='false';process.env.HISTORY_NATIVE_ENABLED='false';process.env.AI_ENABLED='false';
    for(const status of ['APPLIED','ROLLED_BACK'])for(const window of [false,true]){
      const f=fixture({status,window});
      assert.equal(await f.service.persistInbound(event(),'META',{synthetic:true},raw()),false);
      assert.equal(f.review()[0].reason,window?'BEFORE_CUTOFF':'MISSING_WINDOW');assert.deepEqual(f.p.state.normalWrites,[]);
    }
  }finally{for(const key of ['HISTORY_MIGRATION_ENABLED','HISTORY_NATIVE_ENABLED','AI_ENABLED']){if(saved[key]===undefined)delete process.env[key];else process.env[key]=saved[key];}}
});

test('corrupt window or failed durable-review insert aborts the transaction without acknowledging loss',async()=>{
  for(const options of [{window:'corrupt'},{failReview:true}]){
    const f=fixture(options);
    await assert.rejects(f.service.persistInbound(event(),'META',{synthetic:true},raw()));
    assert.equal(f.p.state.reviews.length,0);assert.equal(f.p.state.envelopes.length,0);assert.deepEqual(f.p.state.normalWrites,[]);
  }
});

test('no operational run keeps ordinary Instagram ingress and mirrors unchanged',async()=>{
  const f=fixture({protectedRun:false});
  assert.equal(await f.service.persistInbound(event(),'META',{synthetic:true}),true);assert.equal(f.review().length,0);
  const g=fixture({protectedRun:false});
  assert.equal(await g.service.persistMetaEcho(echo()),true);assert.equal(g.review().length,0);
  const h=fixture({protectedRun:false,conversationExternalId:'customer'});
  assert.equal(await h.service.persistChatwootOutbound(mirror(),{synthetic:true}),true);assert.equal(h.review().length,0);
});

test('guard binding/window reads occur after shared history lock and after canonical merge serialization for all three methods',async()=>{
  for(const kind of ['inbound','echo','mirror']){
    let release,entered;const waiting=new Promise(resolve=>{entered=resolve;});const held=new Promise(resolve=>{release=resolve;});
    const f=fixture({conversationExternalId:kind==='mirror'?'customer':undefined,holdHistoryLock:async()=>{entered();await held;}});
    const pending=kind==='inbound'?f.service.persistInbound(event(),'META',{synthetic:true},raw()):kind==='echo'?f.service.persistMetaEcho(echo(),raw('OUTBOUND')):f.service.persistChatwootOutbound(mirror(),{synthetic:true});
    await waiting;assert.equal(f.p.state.reviews.length,0);assert.equal(f.p.state.messages.length,0);
    release();assert.equal(await pending,false);
    const locks=f.p.state.trace.filter(row=>row[0]==='execute').map(row=>row[2][0]);
    assert.ok(locks.indexOf('client-merge-global')<locks.indexOf('client-merge:client'));
    assert.ok(locks.indexOf('client-merge:client')<locks.indexOf('history-conversation:conversation'));
    const acquired=f.p.state.trace.findIndex(row=>row[0]==='history-lock-acquired');
    assert.ok(f.p.state.trace.findIndex(row=>row[0]==='query')>acquired);
  }
});

test('signed Meta webhook forwards original envelope separately into both real ingress methods',async()=>{
  const secret='synthetic-webhook-secret';
  for(const direction of ['INBOUND','OUTBOUND'])for(const timestamp of [old,later]){
    const f=fixture({account:'123'});
    f.service.sectionValues=async()=>({enabled:true,instagramAccountId:'123',instagramAppSecretEncrypted:encryptSecret(secret)});
    const payload=JSON.parse(JSON.stringify(raw(direction,timestamp)).replaceAll('receiver','123'));
    const body=Buffer.from(JSON.stringify(payload));const signature='sha256='+createHmac('sha256',secret).update(body).digest('hex');
    const result=await f.service.receiveMetaWebhook(body,signature,payload);
    assert.equal(result.accepted,timestamp===old?0:1);
    if(timestamp===old){
      assert.equal(f.review()[0].reason,'BEFORE_CUTOFF');
      assert.deepEqual(JSON.parse(f.review()[0].eventJson).rawPayload,payload);
      assert.deepEqual(f.p.state.normalWrites,[]);
    }else{
      assert.equal(f.review().length,0);
      if(direction==='INBOUND'){
        const stored=f.p.state.messages[0].rawPayload;
        assert.equal(stored.provider,'META');assert.equal(stored.externalMessageId,'mid');
        assert.equal(stored.receivedAt,timestamp);assert.equal(stored.entry,undefined);
      }
    }
  }
});

test('historical inbound review does not schedule normal background profile writes',async()=>{
  const f=fixture({account:'123'});const secret='synthetic-webhook-secret';let profileWrites=0;
  f.service.sectionValues=async()=>({enabled:true,instagramAccountId:'123',instagramAppSecretEncrypted:encryptSecret(secret),instagramAccessTokenEncrypted:encryptSecret('synthetic-token')});
  f.service.enrichMetaProfiles=async()=>{profileWrites++;};
  const payload=JSON.parse(JSON.stringify(raw()).replaceAll('receiver','123'));
  const body=Buffer.from(JSON.stringify(payload));const signature='sha256='+createHmac('sha256',secret).update(body).digest('hex');
  await f.service.receiveMetaWebhook(body,signature,payload);
  assert.equal(f.review().length,1);assert.equal(profileWrites,0);
});

test('both echo ingress paths retain durable review when window is missing and flags are off',async t=>{
  const before=process.env.HISTORY_NATIVE_ENABLED;process.env.HISTORY_NATIVE_ENABLED='false';
  t.after(()=>{if(before===undefined)delete process.env.HISTORY_NATIVE_ENABLED;else process.env.HISTORY_NATIVE_ENABLED=before;});
  for(const method of ['meta','chatwoot']){
    const f=fixture({window:false,conversationExternalId:method==='chatwoot'?'customer':undefined});
    assert.equal(method==='meta'?await f.service.persistMetaEcho(echo(),raw('OUTBOUND',later)):await f.service.persistChatwootOutbound(mirror(),{synthetic:true}),false);
    assert.equal(f.review()[0].reason,'MISSING_WINDOW');assert.deepEqual(f.p.state.normalWrites,[]);
  }
});

test('fresh Instagram external MID does not inherit the bypass of another known native message',async()=>{
  for(const method of ['meta','chatwoot']){
    const f=fixture({duplicate:{},conversationExternalId:method==='chatwoot'?'customer':undefined});
    assert.equal(method==='meta'?await f.service.persistMetaEcho(echo({externalMessageId:'new-mid'}),raw('OUTBOUND',old,'new-mid')):await f.service.persistChatwootOutbound(mirror(),{synthetic:true}),false);
    assert.equal(f.review().length,1);assert.equal(f.p.state.messages.length,1);assert.deepEqual(f.p.state.normalWrites,[]);
  }
});

async function materializedStoryWebhook(t,options={}){
  const folder=await fs.mkdtemp(join(tmpdir(),'history-ingress-story-'));
  const prior=process.env.UPLOADS_DIR;process.env.UPLOADS_DIR=folder;
  t.after(async()=>{
    if(prior===undefined)delete process.env.UPLOADS_DIR;else process.env.UPLOADS_DIR=prior;
    assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep+'history-ingress-story-'));
    await fs.rm(folder,{recursive:true,force:true});
  });
  const f=fixture({...options,account:'123'}),secret='synthetic-webhook-secret';
  f.service.sectionValues=async()=>({enabled:true,instagramAccountId:'123',instagramAppSecretEncrypted:encryptSecret(secret)});
  const remoteUrl='https://scontent.xx.fbcdn.net/synthetic-story.jpg';
  const bytes=Buffer.from('synthetic-story-media-bytes');
  const downloads=[],removed=[];
  t.mock.method(globalThis,'fetch',async url=>{
    assert.equal(url,remoteUrl);downloads.push(url);
    return new Response(bytes,{status:200,headers:{'content-type':'image/jpeg'}});
  });
  const unlink=fs.unlink;
  t.mock.method(fs,'unlink',async path=>{removed.push(path);return unlink(path);});
  const payload=JSON.parse(JSON.stringify(raw()).replaceAll('receiver','123'));
  payload.entry[0].messaging[0].message.reply_to={story:{id:'synthetic-story',url:remoteUrl}};
  const body=Buffer.from(JSON.stringify(payload)),signature='sha256='+createHmac('sha256',secret).update(body).digest('hex');
  return {...f,folder,bytes,remoteUrl,downloads,removed,deliver:()=>f.service.receiveMetaWebhook(body,signature,payload)};
}

test('signed historical story review commits custody of physical bytes without cleanup or normal accepted counts',async t=>{
  const f=await materializedStoryWebhook(t);
  const result=await f.deliver();
  assert.equal(result.accepted,0);assert.equal(f.downloads.length,1);
  assert.equal(f.review().length,1);assert.deepEqual(f.p.state.normalWrites,[]);
  const evidence=JSON.parse(f.review()[0].eventJson);
  assert.equal(evidence.rawPayload.entry[0].messaging[0].message.reply_to.story.url,f.remoteUrl);
  const localUrl=evidence.envelope.metadata.replyTo.storyUrl;
  assert.match(localUrl,/^\/api\/communications\/files\/[a-z0-9-]+\.jpg$/);
  const files=await fs.readdir(join(f.folder,'communication-files'));
  assert.deepEqual(files,[localUrl.split('/').at(-1)]);
  assert.deepEqual(await fs.readFile(join(f.folder,'communication-files',files[0])),f.bytes);
  assert.deepEqual(f.removed,[]);
});

test('signed story commit failure cleans downloaded bytes even after the transaction callback chose review',async t=>{
  const f=await materializedStoryWebhook(t,{failCommit:true});
  await assert.rejects(f.deliver(),/synthetic-commit-failure/);
  assert.equal(f.downloads.length,1);assert.equal(f.removed.length,1);
  assert.deepEqual(await fs.readdir(join(f.folder,'communication-files')),[]);
  assert.equal(f.review().length,0);assert.equal(f.p.state.envelopes.length,0);assert.deepEqual(f.p.state.normalWrites,[]);
});

test('signed normal native duplicate still cleans its newly downloaded story media',async t=>{
  const f=await materializedStoryWebhook(t,{duplicate:{}});
  const result=await f.deliver();
  assert.equal(result.accepted,0);assert.equal(f.downloads.length,1);assert.equal(f.removed.length,1);
  assert.deepEqual(await fs.readdir(join(f.folder,'communication-files')),[]);
  assert.equal(f.review().length,0);assert.deepEqual(f.p.state.normalWrites,[]);
});

test('history review notification fires only after the ingestion transaction commits',async()=>{
  const failed=fixture({failCommit:true});let notifications=0;
  await assert.rejects(failed.service.persistInbound(event(),'META',{synthetic:true},raw(),()=>{notifications++;}),/synthetic-commit-failure/);
  assert.equal(notifications,0);
  const committed=fixture();
  assert.equal(await committed.service.persistInbound(event(),'META',{synthetic:true},raw(),()=>{
    notifications++;assert.equal(committed.p.state.reviews.length,1);
  }),false);
  assert.equal(notifications,1);
});
