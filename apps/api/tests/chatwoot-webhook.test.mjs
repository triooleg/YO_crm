import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { createRequire } from "node:module";

const source=await readFile(new URL("../src/communications/chatwoot-webhook.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const require=createRequire(import.meta.url),module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,require,Buffer,Date,URL,Response,ReadableStream,RangeError,TypeError});
const {boundedChatwootResponseJson,chatwootReadReceiptFromApi,normalizeChatwootMessageUpdate,normalizeChatwootReadReceipt,normalizeChatwootWebhook,verifyChatwootSignature}=module.exports;

test("Chatwoot normalizes Facebook, Instagram, WhatsApp, e-mail and native inboxes",()=>{
  const base={event:"message_created",message_type:"incoming",id:17,content:"Здравствуйте",created_at:1700000000,sender:{id:9,name:"Анна"},conversation:{contact_inbox:{source_id:"contact-9"},account_id:2}};
  const values=["Channel::FacebookPage","Channel::Instagram","Channel::Whatsapp","Channel::Email","Channel::Api"].map(channel_type=>normalizeChatwootWebhook({...base,inbox:{channel_type}})[0].channel);
  assert.deepEqual(JSON.parse(JSON.stringify(values)),["FACEBOOK","INSTAGRAM","WHATSAPP","EMAIL","CHATWOOT"]);
});

test("Chatwoot drops a synthetic Facebook SID e-mail but keeps a real address",()=>{
  const base={event:"message_created",message_type:"incoming",id:17,content:"Hello",created_at:1700000000,inbox:{channel_type:"Channel::FacebookPage"},conversation:{contact_inbox:{source_id:"28487285184292491"},account_id:2,meta:{sender:{email:"fallback@example.com"}}}};
  const [synthetic]=normalizeChatwootWebhook({...base,sender:{id:9,name:"Yolanda Yao",email:"28487285184292491@facebook.com"}});
  const [real]=normalizeChatwootWebhook({...base,id:18,sender:{id:9,name:"Yolanda Yao",email:"yolanda@example.com"}});
  assert.equal(synthetic.email,"fallback@example.com");
  assert.equal(real.email,"yolanda@example.com");
  const [onlySynthetic]=normalizeChatwootWebhook({...base,id:19,sender:{id:9,name:"Yolanda Yao",email:"28487285184292491@facebook.com"},conversation:{...base.conversation,meta:{sender:{email:"28487285184292491@facebook.com"}}}});
  assert.equal(onlySynthetic.email,undefined);
});

test("Chatwoot ignores unsupported and duplicate-unsafe events",()=>{
  assert.equal(normalizeChatwootWebhook({event:"message_updated",message_type:"incoming",id:1}).length,0);
});

test("Chatwoot normalizes only an exact outgoing read update",()=>{
  const payload={event:"message_updated",message_type:"outgoing",status:"read",id:19,updated_at:1700000010,account:{id:2},inbox:{id:7,channel_type:"Channel::Api"},conversation:{id:77,account_id:2,inbox_id:7}};
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeChatwootReadReceipt(payload))),{
    channel:"CHATWOOT",
    externalMessageId:"chatwoot:2:19",
    accountId:"2",
    inboxId:"7",
    conversationId:"77",
    receivedAt:"2023-11-14T22:13:30.000Z",
  });
  for(const invalid of [
    {...payload,status:"delivered"},
    {...payload,message_type:"incoming"},
    {...payload,private:true},
    {...payload,updated_at:"bad"},
    {...payload,account:{},conversation:{...payload.conversation,account_id:undefined}},
    {...payload,inbox:{},conversation:{...payload.conversation,inbox_id:undefined}},
  ])assert.equal(normalizeChatwootReadReceipt(invalid),undefined);
});

test("Chatwoot resolves a source-shaped message update through the scoped messages API",()=>{
  const sourcePayload={event:"message_updated",message_type:"outgoing",id:19,created_at:"2026-09-01T03:10:00.000Z",account:{id:2},inbox:{id:7,channel_type:"Channel::Api"},conversation:{id:77,account_id:2,inbox_id:7}};
  const candidate=normalizeChatwootMessageUpdate(sourcePayload);
  assert.equal(candidate.externalMessageId,"chatwoot:2:19");
  assert.equal(normalizeChatwootReadReceipt(sourcePayload),undefined);
  const receipt=chatwootReadReceiptFromApi(candidate,{payload:[{id:19,account_id:2,inbox_id:7,conversation_id:77,message_type:1,status:"read",updated_at:1788232320}]});
  assert.equal(receipt.receivedAt.toISOString(),"2026-09-01T03:12:00.000Z");
  for(const message of [
    {id:19,account_id:2,inbox_id:7,conversation_id:77,message_type:1,status:"delivered",updated_at:1788232320},
    {id:19,account_id:3,inbox_id:7,conversation_id:77,message_type:1,status:"read",updated_at:1788232320},
    {id:19,account_id:2,inbox_id:8,conversation_id:77,message_type:1,status:"read",updated_at:1788232320},
    {id:19,account_id:2,inbox_id:7,conversation_id:78,message_type:1,status:"read",updated_at:1788232320},
    {id:19,account_id:2,inbox_id:7,conversation_id:77,message_type:0,status:"read",updated_at:1788232320},
  ])assert.equal(chatwootReadReceiptFromApi(candidate,{payload:[message]}),undefined);
});

test("Chatwoot read lookup parses only a bounded streamed JSON response",async()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(await boundedChatwootResponseJson(new Response('{"payload":[]}')))),{payload:[]});
  await assert.rejects(()=>boundedChatwootResponseJson(new Response("1234",{headers:{"content-length":"4"}}),3),/CHATWOOT_RESPONSE_TOO_LARGE/);
  await assert.rejects(()=>boundedChatwootResponseJson(new Response("1234"),3),/CHATWOOT_RESPONSE_TOO_LARGE/);
  await assert.rejects(()=>boundedChatwootResponseJson(new Response("not-json")),/Unexpected token|not valid JSON/);
});

test("Chatwoot preserves safe inbound photo and video attachment metadata",()=>{
  const base={event:"message_created",message_type:"incoming",id:18,content:null,created_at:1700000000,account:{id:2},inbox:{id:2,channel_type:"Channel::Api"},sender:{id:9,name:"Анна"},conversation:{id:77,contact_inbox:{source_id:"contact-9"},account_id:2}};
  const [event]=normalizeChatwootWebhook({...base,attachments:[
    {file_type:"image",data_url:"https://chatwoot.example/rails/active_storage/photo.jpg",thumb_url:"https://chatwoot.example/thumb.jpg",extension:"jpg",file_size:1200,width:640,height:480},
    {file_type:"video",data_url:"https://chatwoot.example/rails/active_storage/video.mp4",extension:"mp4",file_size:2300},
  ]});
  assert.equal(event.direction,"INBOUND");
  assert.equal(event.content,"[Фото]");
  assert.equal(event.metadata.chatwootConversationId,"77");
  assert.deepEqual(JSON.parse(JSON.stringify(event.metadata.attachments)),[
    {type:"image",url:"https://chatwoot.example/rails/active_storage/photo.jpg",thumbnailUrl:"https://chatwoot.example/thumb.jpg",mimeType:"image/jpeg",sizeBytes:1200,width:640,height:480,name:"attachment.jpg"},
    {type:"video",url:"https://chatwoot.example/rails/active_storage/video.mp4",mimeType:"video/mp4",sizeBytes:2300,name:"attachment.mp4"},
  ]);
});

test("Chatwoot normalizes outgoing messages against the contact identity",()=>{
  const [event]=normalizeChatwootWebhook({event:"message_created",message_type:"outgoing",id:19,content:"Ответ менеджера",created_at:1700000001,account:{id:2},inbox:{id:2,channel_type:"Channel::Api"},sender:{id:3,name:"Manager"},conversation:{id:77,contact_inbox:{source_id:"contact-9"},meta:{sender:{id:9,name:"Анна"}},account_id:2}});
  assert.equal(event.direction,"OUTBOUND");
  assert.equal(event.externalSenderId,"contact-9");
  assert.equal(event.externalMessageId,"chatwoot:2:19");
  assert.equal(event.displayName,"Анна");
  assert.equal(event.metadata.chatwootConversationId,"77");
});

test("Chatwoot keeps canonical sender and configured scope identifiers",()=>{
  const [event]=normalizeChatwootWebhook({event:"message_created",message_type:"incoming",id:4,content:"Письмо",created_at:"bad",account:{id:8},inbox:{id:12,channel_type:"Channel::Email"},sender:{id:2,name:"Анна",email:"anna@example.com",phone_number:"+380501112233"},conversation:{contact_inbox:{source_id:"mail-2"}}});
  assert.equal(event.accountId,"8");assert.equal(event.inboxId,"12");assert.equal(event.email,"anna@example.com");assert.equal(event.phone,"+380501112233");assert.equal(Number.isNaN(event.receivedAt.getTime()),false);
});

test("Chatwoot prefers the incoming message sender name over an obsolete generated conversation name",()=>{
  const [event]=normalizeChatwootWebhook({
    event:"message_created",message_type:"incoming",id:20,content:"Hello",created_at:1700000002,
    account:{id:2},inbox:{id:2,channel_type:"Channel::Api"},
    sender:{id:9,name:"Nicola.Faccioli",email:"nicola@example.com"},
    conversation:{id:117,account_id:2,contact_inbox:{source_id:"contact-9"},meta:{sender:{id:9,name:"delicate-pond-188"}}},
  });
  assert.equal(event.displayName,"Nicola.Faccioli");
  assert.equal(event.email,"nicola@example.com");
});

test("Chatwoot signature uses raw request body",()=>{
  const crypto=require("node:crypto"),body=Buffer.from('{"event":"message_created"}'),secret="test-webhook-secret";
  const signature=crypto.createHmac("sha256",secret).update(body).digest("hex");
  assert.equal(verifyChatwootSignature(body,signature,secret),true);
  assert.equal(verifyChatwootSignature(Buffer.from("changed"),signature,secret),false);
});
