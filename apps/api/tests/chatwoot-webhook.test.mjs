import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import { createRequire } from "node:module";

const source=await readFile(new URL("../src/communications/chatwoot-webhook.ts",import.meta.url),"utf8");
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
const require=createRequire(import.meta.url),module={exports:{}};vm.runInNewContext(js,{module,exports:module.exports,require,Buffer,Date,URL});
const {normalizeChatwootWebhook,verifyChatwootSignature}=module.exports;

test("Chatwoot normalizes Facebook, Instagram, WhatsApp, e-mail and native inboxes",()=>{
  const base={event:"message_created",message_type:"incoming",id:17,content:"Здравствуйте",created_at:1700000000,sender:{id:9,name:"Анна"},conversation:{contact_inbox:{source_id:"contact-9"},account_id:2}};
  const values=["Channel::FacebookPage","Channel::Instagram","Channel::Whatsapp","Channel::Email","Channel::Api"].map(channel_type=>normalizeChatwootWebhook({...base,inbox:{channel_type}})[0].channel);
  assert.deepEqual(JSON.parse(JSON.stringify(values)),["FACEBOOK","INSTAGRAM","WHATSAPP","EMAIL","CHATWOOT"]);
});

test("Chatwoot ignores unsupported and duplicate-unsafe events",()=>{
  assert.equal(normalizeChatwootWebhook({event:"message_updated",message_type:"incoming",id:1}).length,0);
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

test("Chatwoot signature uses raw request body",()=>{
  const crypto=require("node:crypto"),body=Buffer.from('{"event":"message_created"}'),secret="test-webhook-secret";
  const signature=crypto.createHmac("sha256",secret).update(body).digest("hex");
  assert.equal(verifyChatwootSignature(body,signature,secret),true);
  assert.equal(verifyChatwootSignature(Buffer.from("changed"),signature,secret),false);
});
