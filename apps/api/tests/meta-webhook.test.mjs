import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const source = await readFile(new URL("../src/communications/meta-webhook.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/communications/communications.service.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} }, require = createRequire(import.meta.url);
vm.runInNewContext(javascript, { module, exports: module.exports, require, Buffer });
const { facebookFallbackProfileTargets, isMetaMessageReadAt, legacyConversationMatchesReceiver, mergeMetaEchoMetadata, mergeMetaReadMetadata, metaConnectedAccountLabel, metaConversationInboxUrl, metaConversationExternalId, metaEchoAlreadyProcessed, metaEchoConversationExternalIds, metaFacebookProfilePatch, metaIdentityLogRef, metaProfileTargets, metaWebhookReceiverMatches, normalizeMetaControlEvents, normalizeMetaEchoMessages, normalizeMetaFacebookProfile, normalizeMetaWebhook, persistMetaFacebookProfilePatch, resolveMetaFacebookProfile, resolveMetaFacebookProfileWithFallback, runFacebookProfileBackfillBatch, safeMetaWebhookLogSummary, summarizeMetaWebhook, uniqueMetaControlTarget, verifyMetaSignature } = module.exports;

test("normalizes Facebook, Instagram and WhatsApp into one inbound contract", () => {
  const facebook = normalizeMetaWebhook({ object: "page", entry: [{ messaging: [{ sender: { id: "fb-1" }, timestamp: 1000, message: { mid: "fb-mid", text: "Facebook text" } }] }] });
  const instagram = normalizeMetaWebhook({ object: "instagram", entry: [{ messaging: [{ sender: { id: "ig-1" }, timestamp: 2000, message: { mid: "ig-mid", attachments: [{ type: "image" }] } }] }] });
  const whatsapp = normalizeMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { contacts: [{ wa_id: "3801", profile: { name: "Anna" } }], messages: [{ id: "wa-mid", from: "3801", timestamp: "3", type: "text", text: { body: "WhatsApp text" } }] } }] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(facebook.map(x => [x.channel, x.externalSenderId, x.externalMessageId, x.content]))), [["FACEBOOK", "fb-1", "fb-mid", "Facebook text"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(instagram.map(x => [x.channel, x.externalSenderId, x.externalMessageId, x.content]))), [["INSTAGRAM", "ig-1", "ig-mid", "[Фото]"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(whatsapp.map(x => [x.channel, x.externalSenderId, x.externalMessageId, x.displayName, x.content]))), [["WHATSAPP", "3801", "wa-mid", "Anna", "WhatsApp text"]]);
});

test("normalizes Messenger standby messages while another app controls the thread", () => {
  const [message] = normalizeMetaWebhook({ object: "page", entry: [{ id: "page-1", standby: [{ sender: { id: "psid-standby" }, recipient: { id: "page-1" }, timestamp: 1000, message: { mid: "standby-mid", text: "Standby text" } }] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(message)), {
    channel: "FACEBOOK",
    externalSenderId: "psid-standby",
    externalMessageId: "standby-mid",
    content: "Standby text",
    receiverId: "page-1",
    receivedAt: "1970-01-01T00:00:01.000Z",
    metadata: { messageType: "text", handoverSource: "standby" },
  });
});

test("Facebook sender profile is resolved and technical lead names are upgraded",()=>{
  assert.match(source,/"first_name,last_name,profile_pic"/);
  assert.match(source,/"locale,timezone"/);
  assert.match(service,/META_PROFILE_LOOKUP_FAILED/);
  assert.match(service,/Facebook\|Instagram/);
});

test("Facebook identity survives an unavailable optional profile lookup",async()=>{
  const requested=[];
  const profile=await resolveMetaFacebookProfile(async fields=>{
    requested.push(fields);
    if(fields==="locale,timezone")throw new Error("optional fields unavailable");
    return {first_name:"Юлия",last_name:"Огилько",profile_pic:"https://example.com/avatar.jpg"};
  });
  assert.deepEqual(requested,["first_name,last_name,profile_pic","locale,timezone"]);
  assert.deepEqual(JSON.parse(JSON.stringify(profile)),{first_name:"Юлия",last_name:"Огилько",profile_pic:"https://example.com/avatar.jpg"});
});

test("Facebook optional profile details are preserved when Meta returns them",async()=>{
  const profile=await resolveMetaFacebookProfile(async fields=>fields==="locale,timezone"
    ? {locale:"uk_UA",timezone:2}
    : {first_name:"Юлия",last_name:"Огилько",profile_pic:"https://example.com/avatar.jpg"});
  assert.deepEqual(JSON.parse(JSON.stringify(profile)),{first_name:"Юлия",last_name:"Огилько",profile_pic:"https://example.com/avatar.jpg",locale:"uk_UA",timezone:2});
});

test("Facebook User Profile API remains the primary identity source",async()=>{
  const calls=[];
  const result=await resolveMetaFacebookProfileWithFallback(
    async fields=>(calls.push(["profile",fields]),fields==="locale,timezone"?{}:{first_name:"Oleg",last_name:"Ogilko",profile_pic:"https://example.com/a.jpg"}),
    async()=>{calls.push(["conversations"]);return {data:[]}},
    ()=>false,
    "psid-1","page-1",
  );
  assert.equal(result.source,"USER_PROFILE");
  assert.equal(calls.some(([kind])=>kind==="conversations"),false);
  assert.deepEqual(JSON.parse(JSON.stringify(result.profile)),{first_name:"Oleg",last_name:"Ogilko",profile_pic:"https://example.com/a.jpg"});
});

test("Facebook code 100 subcode 33 falls back to the exact conversation participant",async()=>{
  const unavailable=Object.assign(new Error("unavailable"),{failure:{code:100,subcode:33}});
  const result=await resolveMetaFacebookProfileWithFallback(
    async()=>{throw unavailable},
    async()=>({data:[{id:"thread",participants:{data:[{id:"page-1",name:"YOLeotard"},{id:"psid-1",name:"Rachel Smith"}]}}]}),
    error=>error===unavailable,
    "psid-1","page-1",
  );
  assert.equal(result.source,"CONVERSATIONS");
  assert.deepEqual(JSON.parse(JSON.stringify(result.profile)),{name:"Rachel Smith"});
  await assert.rejects(()=>resolveMetaFacebookProfileWithFallback(async()=>{throw new Error("network")},async()=>({data:[]}),()=>false,"psid-1","page-1"),/network/);
  const ambiguous=await resolveMetaFacebookProfileWithFallback(async()=>{throw unavailable},async()=>({data:[{participants:{data:[{id:"psid-1",name:"Rachel"},{id:"psid-1",name:"Other"}]}}]}),error=>error===unavailable,"psid-1","page-1");
  assert.deepEqual(JSON.parse(JSON.stringify(ambiguous.profile)),{});
});

test("Facebook backfill targets only exact fallback clients and deduplicates clients",()=>{
  const targets=facebookFallbackProfileTargets([
    {externalId:"page-1:101",client:{id:"c1",displayName:"Facebook 101"}},
    {externalId:"page-1:101",client:{id:"c1",displayName:"Facebook 101"}},
    {externalId:"page-1:102",client:{id:"c2",displayName:"Manual name"}},
    {externalId:"page-2:103",client:{id:"c3",displayName:"Facebook 103"}},
  ],"page-1");
  assert.deepEqual(JSON.parse(JSON.stringify(targets)),[{clientId:"c1",psid:"101",needsName:true,needsAvatar:false}]);
});

test("Facebook backfill retries a missing avatar without changing a real name", async()=>{
  const rows=[{externalId:"page-1:101",client:{id:"client-1",displayName:"Nastasya Ty",avatarUrl:null}}];
  const writes=[];
  const result=await runFacebookProfileBackfillBatch(rows,"page-1",50,false,async()=>({source:"USER_PROFILE",profile:{displayName:"Nastasya Ty",avatarUrl:"https://example.com/avatar.jpg"}}),async(psid,profile)=>(writes.push([psid,profile]),true));
  assert.equal(result.fallbackClientsFound,0);
  assert.equal(result.avatarClientsFound,1);
  assert.equal(result.avatarsResolvedViaUserProfile,1);
  assert.equal(result.avatarsUnavailable,0);
  assert.equal(result.updated,1);
  assert.deepEqual(writes,[["101",{displayName:"Nastasya Ty",avatarUrl:"https://example.com/avatar.jpg"}]]);
});

test("Facebook backfill dry-run is write-free and cursor advances across ineligible rows",async()=>{
  const rows=[
    {externalId:"page-1:bad",client:{id:"c1",displayName:"Facebook test"}},
    {externalId:"page-1:102",client:{id:"c2",displayName:"Facebook 102"}},
  ];
  let resolves=0,writes=0;
  const first=await runFacebookProfileBackfillBatch(rows,"page-1",1,true,async()=>{resolves++;return{source:"USER_PROFILE",profile:{displayName:"Ignored"}}},async()=>{writes++;return true});
  assert.deepEqual(JSON.parse(JSON.stringify(first)),{dryRun:true,fallbackClientsFound:0,avatarClientsFound:0,resolvedViaUserProfile:0,resolvedViaConversations:0,avatarsResolvedViaUserProfile:0,avatarsUnavailable:0,unresolved:0,updated:0,nextCursor:"c1"});
  assert.equal(resolves,0);assert.equal(writes,0);
  const second=await runFacebookProfileBackfillBatch(rows.slice(1),"page-1",1,true,async()=>({source:"CONVERSATIONS",profile:{displayName:"Rachel Smith",firstName:"Rachel Smith"}}),async()=>{writes++;return true});
  assert.equal(second.fallbackClientsFound,1);assert.equal(second.resolvedViaConversations,1);assert.equal(second.nextCursor,null);assert.equal(writes,0);
});

test("Facebook backfill apply is idempotent and failed optimistic updates create no success",async()=>{
  const rows=[{externalId:"page-1:101",client:{id:"c1",displayName:"Facebook 101"}}];
  let currentName="Facebook 101",writes=0,histories=0;
  const resolve=async()=>({source:"USER_PROFILE",profile:{displayName:"Anna",firstName:"Anna",avatarUrl:"https://example.com/a.jpg"}});
  const persist=async(_psid,profile)=>{
    writes++;
    if(currentName!=="Facebook 101")return false;
    currentName=profile.displayName;histories++;return true;
  };
  const applied=await runFacebookProfileBackfillBatch(rows,"page-1",50,false,resolve,persist);
  const retried=await runFacebookProfileBackfillBatch(rows,"page-1",50,false,resolve,persist);
  assert.equal(applied.updated,1);assert.equal(retried.updated,0);assert.equal(currentName,"Anna");assert.equal(histories,1);assert.equal(writes,2);
  const protectedRows=[
    {externalId:"page-1:102",client:{id:"c2",displayName:"Manual name"}},
    {externalId:"page-1:103",client:{id:"c3",displayName:"Facebook 103"}},
  ];
  const protectedResult=await runFacebookProfileBackfillBatch(protectedRows,"page-1",50,false,resolve,async()=>false);
  assert.equal(protectedResult.fallbackClientsFound,1);assert.equal(protectedResult.updated,0);
});

test("normalizes available Facebook profile details without inventing contacts",()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeMetaFacebookProfile({
    name:"Юлия Огилько",first_name:"Юлия",last_name:"Огилько",
    profile_pic:"https://scontent.xx.fbcdn.net/avatar.jpg",locale:"uk_UA",timezone:2,
  }))),{
    displayName:"Юлия Огилько",firstName:"Юлия",lastName:"Огилько",
    avatarUrl:"https://scontent.xx.fbcdn.net/avatar.jpg",language:"uk",
    timezone:"UTC+02:00",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeMetaFacebookProfile({name:"Anna",locale:"en"}))),{
    displayName:"Anna",firstName:"Anna",language:"en",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeMetaFacebookProfile({
    profile_pic:"javascript:alert(1)",locale:"invalid_locale_value",
  }))),{});
});

test("profile normalization rejects invented location and malformed timezone",()=>{
  for (const timezone of [null,"",false,2.999]) assert.equal(normalizeMetaFacebookProfile({timezone}).timezone,undefined);
  assert.equal(normalizeMetaFacebookProfile({locale:"uk_UA"}).country,undefined);
});

test("profile patch contains only real missing-field changes and preserves maintained values",()=>{
  const empty={firstName:"Facebook 123",lastName:null,displayName:"Facebook 123",avatarUrl:null,country:null,email:null,phone:null,language:null,timezone:null};
  assert.deepEqual(JSON.parse(JSON.stringify(metaFacebookProfilePatch(empty,{displayName:"Anna",firstName:"Anna"}))),{displayName:"Anna",firstName:"Anna"});
  const maintained={...empty,firstName:"Manual",displayName:"Manual",avatarUrl:"https://example.com/a.jpg",language:"ru",timezone:"UTC+02:00"};
  assert.deepEqual(JSON.parse(JSON.stringify(metaFacebookProfilePatch(maintained,{displayName:"Meta",firstName:"Meta",avatarUrl:"https://example.com/b.jpg",language:"uk",timezone:"UTC+03:00"}))),{});
});

test("connected account labels expose no credentials", () => {
  const settings = { pageName: "YOLeotard", pageId: "page-1", instagramUsername: "yoleotard", instagramAccountId: "ig-1", pageAccessTokenEncrypted: "secret" };
  assert.equal(metaConnectedAccountLabel("FACEBOOK", settings), "YOLeotard");
  assert.equal(metaConnectedAccountLabel("INSTAGRAM", settings), "@yoleotard");
  assert.equal(metaConnectedAccountLabel("EMAIL", settings), "");
  assert.equal(JSON.stringify(metaConnectedAccountLabel("FACEBOOK", settings)).includes("secret"), false);
});

test("Meta conversation links are scoped and reject unsafe identifiers", () => {
  assert.equal(metaConversationInboxUrl("FACEBOOK", "261203841288993:27352420207764662", { pageId: "261203841288993" }), "https://business.facebook.com/latest/inbox/messenger?asset_id=261203841288993&selected_item_id=27352420207764662");
  assert.equal(metaConversationInboxUrl("INSTAGRAM", "17841407931852361:708610235356092", { instagramClientUsername: "client.name" }), "https://ig.me/m/client.name");
  assert.equal(metaConversationInboxUrl("FACEBOOK", "999:2", { pageId: "1" }), "");
  assert.equal(metaConversationInboxUrl("INSTAGRAM", "17841407931852361:708610235356092", { pageId: "261203841288993" }), "");
  assert.equal(metaConversationInboxUrl("INSTAGRAM", "17841407931852361:708610235356092", { pageId: "261203841288993", instagramClientUsername: "bad/name" }), "");
  assert.equal(metaConversationInboxUrl("FACEBOOK", "1:javascript:alert(1)", { pageId: "1" }), "");
  assert.equal(metaConversationInboxUrl("EMAIL", "1:2", { pageId: "1" }), "");
});

test("profile persistence updates an active client before recording exact history",async()=>{
  const calls=[];
  const before={firstName:"Facebook 123",lastName:null,displayName:"Facebook 123",avatarUrl:null,country:null,email:null,phone:null,language:null,timezone:null};
  assert.equal(await persistMetaFacebookProfilePatch(before,{displayName:"Anna",firstName:"Anna",avatarUrl:"https://example.com/a.jpg"},async patch=>(calls.push(["update",patch]),true),async fields=>{calls.push(["history",fields])}),true);
  assert.deepEqual(JSON.parse(JSON.stringify(calls)),[["update",{displayName:"Anna",firstName:"Anna",avatarUrl:"https://example.com/a.jpg"}],["history",["displayName","firstName","avatarUrl"]]]);
  const blocked=[];
  assert.equal(await persistMetaFacebookProfilePatch(before,{displayName:"Anna",firstName:"Anna"},async patch=>(blocked.push(["update",patch]),false),async fields=>{blocked.push(["history",fields])}),false);
  assert.equal(blocked.some(([kind])=>kind==="history"),false);
});

test("Instagram username patch is separate and idempotent", () => {
  const before={firstName:"Manual name",lastName:null,displayName:"Manual name",avatarUrl:null,country:null,email:null,phone:null,language:null,timezone:null,instagramUsername:null};
  assert.deepEqual(JSON.parse(JSON.stringify(metaFacebookProfilePatch(before,{displayName:"Provider name",firstName:"Provider name",instagramUsername:"gymnast"}))),{instagramUsername:"gymnast"});
  assert.deepEqual(JSON.parse(JSON.stringify(metaFacebookProfilePatch({...before,instagramUsername:"gymnast"},{instagramUsername:"gymnast"}))),{});
});

test("profile enrichment guards archived clients and logs only pseudonymous Meta identities",()=>{
  assert.match(service,/updateMany\(\{where:\{id:before\.id,archivedAt:null,displayName:before\.displayName,firstName:before\.firstName,lastName:before\.lastName,avatarUrl:before\.avatarUrl,language:before\.language,timezone:before\.timezone,instagramUsername:before\.instagramUsername\}/);
  assert.match(service,/persistMetaFacebookProfilePatch/);
  assert.doesNotMatch(service,/senderId:event\.externalSenderId/);
  assert.equal(metaIdentityLogRef("psid-123"),metaIdentityLogRef("psid-123"));
  assert.notEqual(metaIdentityLogRef("psid-123"),"psid-123");
});

test("Meta subscription and persistence include outbound message echoes", () => {
  assert.match(service, /subscribed_fields:\s*"messages,message_echoes,standby,messaging_postbacks,message_reads,messaging_optins"/);
  assert.match(service, /normalizeMetaEchoMessages\(payload\)/);
  assert.match(service, /direction:\s*MessageDirection\.OUTBOUND/);
  assert.match(service, /status:\s*MessageStatus\.SENT/);
  assert.match(service, /source:\s*"META_ECHO"/);
});

test("Meta carries configured receiver ids for scope validation",()=>{
  const [facebook]=normalizeMetaWebhook({object:"page",entry:[{id:"page-1",messaging:[{sender:{id:"s"},message:{mid:"m",text:"x"}}]}]});
  const [whatsapp]=normalizeMetaWebhook({object:"whatsapp_business_account",entry:[{changes:[{value:{metadata:{phone_number_id:"phone-1"},messages:[{id:"w",from:"1",type:"text",text:{body:"x"}}]}}]}]});
  assert.equal(facebook.receiverId,"page-1");assert.equal(whatsapp.receiverId,"phone-1");
});

test("Meta receiver scope keeps OAuth and verified Instagram namespaces separate",()=>{
  const settings={pageId:"page-1",instagramAccountId:"28156785147355107",instagramWebhookReceiverId:"17841407931852361",whatsappPhoneNumberId:"phone-1"};
  assert.equal(metaWebhookReceiverMatches("FACEBOOK","page-1",settings),true);
  assert.equal(metaWebhookReceiverMatches("FACEBOOK","page-2",settings),false);
  assert.equal(metaWebhookReceiverMatches("INSTAGRAM","28156785147355107",settings),true);
  assert.equal(metaWebhookReceiverMatches("INSTAGRAM","17841407931852361",settings),true);
  assert.equal(metaWebhookReceiverMatches("INSTAGRAM","999",settings),false);
  assert.equal(metaWebhookReceiverMatches("INSTAGRAM","17841407931852361",{...settings,instagramWebhookReceiverId:"unsafe"}),false);
  assert.equal(metaWebhookReceiverMatches("WHATSAPP","phone-1",settings),true);
  assert.equal(metaWebhookReceiverMatches("WHATSAPP","phone-2",settings),false);
});

test("one receiver scope helper gates messages echoes and controls",()=>{
  assert.equal((service.match(/metaWebhookReceiverMatches\(/g)||[]).length>=3,true);
  assert.doesNotMatch(service,/event\.channel === "FACEBOOK" \? values\.pageId : event\.channel === "INSTAGRAM" \? values\.instagramAccountId/);
});

test("scopes Messenger conversations by Page ID and PSID", () => {
  assert.equal(metaConversationExternalId("page-a", "same-psid"), "page-a:same-psid");
  assert.equal(metaConversationExternalId("page-b", "same-psid"), "page-b:same-psid");
  assert.notEqual(metaConversationExternalId("page-a", "same-psid"), metaConversationExternalId("page-b", "same-psid"));
});

test("profile enrichment keeps identical sender IDs isolated by Facebook Page",()=>{
 const targets=metaProfileTargets([{channel:"FACEBOOK",receiverId:"page-a",externalSenderId:"same",externalMessageId:"1",content:"a",receivedAt:new Date(),metadata:{messageType:"text"}},{channel:"FACEBOOK",receiverId:"page-b",externalSenderId:"same",externalMessageId:"2",content:"b",receivedAt:new Date(),metadata:{messageType:"text"}}]);
 assert.deepEqual(JSON.parse(JSON.stringify(targets)),[{channel:"FACEBOOK",receiverId:"page-a",senderId:"same"},{channel:"FACEBOOK",receiverId:"page-b",senderId:"same"}]);
 assert.match(service,/externalId_channel/);
});

test("Instagram sender profile is enriched with name and avatar in its own channel", () => {
  const targets = metaProfileTargets([{channel:"INSTAGRAM",receiverId:"ig-business",externalSenderId:"igsid-1",externalMessageId:"1",content:"x",receivedAt:new Date(),metadata:{messageType:"text"}}]);
  assert.deepEqual(JSON.parse(JSON.stringify(targets)), [{channel:"INSTAGRAM",receiverId:"ig-business",senderId:"igsid-1"}]);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeMetaFacebookProfile({username:"gymnast",profile_pic:"https://cdn.example/avatar.jpg"}))), {
    displayName:"gymnast", firstName:"gymnast", avatarUrl:"https://cdn.example/avatar.jpg", instagramUsername:"gymnast",
  });
  assert.match(service, /provider==="instagram"/);
  assert.match(service, /instagramGraph<MetaFacebookProfile>/);
});

test("migrates a legacy PSID conversation only when its saved receiver matches the Page", () => {
  assert.equal(legacyConversationMatchesReceiver({ receiverId: "page-a" }, "page-a"), true);
  assert.equal(legacyConversationMatchesReceiver({ receiverId: "page-a" }, "page-b"), false);
  assert.equal(legacyConversationMatchesReceiver({}, "page-a"), false);
  assert.equal(legacyConversationMatchesReceiver(null, "page-a"), false);
});

test("echo lookup permits a legacy PSID only for the same saved Page receiver", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(metaEchoConversationExternalIds("page-a", "psid-1", { receiverId: "page-a" }))), ["page-a:psid-1", "psid-1"]);
  assert.deepEqual(JSON.parse(JSON.stringify(metaEchoConversationExternalIds("page-a", "psid-1", { receiverId: "page-b" }))), ["page-a:psid-1"]);
  assert.deepEqual(JSON.parse(JSON.stringify(metaEchoConversationExternalIds("page-a", "psid-1", null))), ["page-a:psid-1"]);
});

test("preserves Messenger attachment URLs and sticker metadata", () => {
  const [message] = normalizeMetaWebhook({ object: "page", entry: [{ id: "page-1", messaging: [{ sender: { id: "psid-1" }, recipient: { id: "page-1" }, timestamp: 42, message: { mid: "mid-1", sticker_id: 369239263222822, attachments: [{ type: "image", payload: { url: "https://cdn.example/image.jpg", sticker_id: 369239263222822 } }, { type: "file", payload: { url: "https://cdn.example/file.pdf" } }] } }] }] });
  assert.equal(message.content, "[Стикер]\n[Файл]");
  assert.deepEqual(JSON.parse(JSON.stringify(message.metadata.attachments)), [
    { type: "sticker", url: "https://cdn.example/image.jpg", stickerId: "369239263222822" },
    { type: "file", url: "https://cdn.example/file.pdf" },
  ]);
});

test("summarizes every Messenger event before filtering without message text or attachment URLs", () => {
  const summary = summarizeMetaWebhook({ object: "page", entry: [{ id: "page-1", messaging: [
    { sender: { id: "psid-1" }, recipient: { id: "page-1" }, timestamp: 42, message: { mid: "mid-1", text: "private text", attachments: [{ type: "image", payload: { url: "https://private.example/token" } }] } },
    { sender: { id: "page-1" }, recipient: { id: "psid-1" }, timestamp: 43, message: { mid: "mid-2", is_echo: true, text: "private echo" } },
    { sender: { id: "psid-1" }, recipient: { id: "page-1" }, timestamp: 44, read: { watermark: 44 } },
  ] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(summary)), [
    { object: "page", entryId: "page-1", eventType: "message", senderId: "psid-1", recipientId: "page-1", mid: "mid-1", hasText: true, attachmentCount: 1, attachmentTypes: ["image"], isEcho: false, isTest: false },
    { object: "page", entryId: "page-1", eventType: "message_echo", senderId: "page-1", recipientId: "psid-1", mid: "mid-2", hasText: true, attachmentCount: 0, attachmentTypes: [], isEcho: true, isTest: false },
    { object: "page", entryId: "page-1", eventType: "read", senderId: "psid-1", recipientId: "page-1", hasText: false, attachmentCount: 0, attachmentTypes: [], isEcho: false, isTest: false },
  ]);
  assert.equal(JSON.stringify(summary).includes("private text"), false);
  assert.equal(JSON.stringify(summary).includes("private.example"), false);
});

test("ignores delivery statuses and outgoing echo events", () => {
  assert.equal(normalizeMetaWebhook({ object: "page", entry: [{ messaging: [{ sender: { id: "x" }, message: { mid: "m", text: "echo", is_echo: true } }] }] }).length, 0);
  assert.equal(normalizeMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "status" }] } }] }] }).length, 0);
});

test("normalizes Facebook message echoes as outbound messages with text and attachments", () => {
  const [echo] = normalizeMetaEchoMessages({ object: "page", entry: [{ id: "page-1", messaging: [{ sender: { id: "page-1" }, recipient: { id: "psid-1" }, timestamp: 42, message: { mid: "echo-mid", is_echo: true, text: "Ответ клиенту", attachments: [{ type: "image", payload: { url: "https://cdn.example/reply.jpg" } }] } }] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(echo)), {
    channel: "FACEBOOK",
    externalRecipientId: "psid-1",
    externalMessageId: "echo-mid",
    content: "Ответ клиенту",
    receiverId: "page-1",
    receivedAt: "1970-01-01T00:00:00.042Z",
    metadata: { messageType: "text", attachmentTypes: ["image"], attachments: [{ type: "image", url: "https://cdn.example/reply.jpg" }] },
  });
});

test("normalizes a read watermark without a message id and keeps exact account identity", () => {
  const [event] = normalizeMetaControlEvents({ object:"page", entry:[{ id:"page-1", messaging:[{ sender:{id:"psid-1"}, recipient:{id:"page-1"}, timestamp:1700000005000, read:{watermark:1700000000000} }] }] });
  assert.equal(event.eventType,"read");
  assert.equal(event.receiverId,"page-1");
  assert.equal(event.externalPartyId,"psid-1");
  assert.equal(event.externalMessageId,undefined);
  assert.equal(event.readWatermarkAt.toISOString(),"2023-11-14T22:13:20.000Z");
});

test("normalizes an Instagram read receipt by exact message id", () => {
  const [event] = normalizeMetaControlEvents({ object:"instagram", entry:[{ id:"ig-account-1", messaging:[{ sender:{id:"igsid-1"}, recipient:{id:"ig-account-1"}, timestamp:1700000005000, read:{mid:"ig-mid-1"} }] }] });
  assert.equal(event.channel,"INSTAGRAM");
  assert.equal(event.eventType,"read");
  assert.equal(event.receiverId,"ig-account-1");
  assert.equal(event.externalPartyId,"igsid-1");
  assert.equal(event.externalMessageId,"ig-mid-1");
  assert.equal(event.readWatermarkAt,undefined);
});

test("read metadata is monotonic and idempotent",()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(mergeMetaReadMetadata({source:"CRM"},new Date("2026-08-30T10:00:00Z")))),{source:"CRM",metaReadAt:"2026-08-30T10:00:00.000Z"});
  assert.deepEqual(JSON.parse(JSON.stringify(mergeMetaReadMetadata({source:"CRM",metaReadAt:"2026-08-30T11:00:00.000Z"},new Date("2026-08-30T10:00:00Z")))),{source:"CRM",metaReadAt:"2026-08-30T11:00:00.000Z"});
});

test("malformed read watermarks are ignored instead of becoming now",()=>{
  for(const watermark of [undefined,null,"bad",0,-1,1.5,"1.5",8640000000000001]){
    const [event]=normalizeMetaControlEvents({object:"page",entry:[{id:"page-1",messaging:[{sender:{id:"psid-1"},recipient:{id:"page-1"},timestamp:1700000005000,read:{watermark}}]}]});
    assert.equal(event.readWatermarkAt,undefined);
  }
});

test("read watermark uses sentAt so an old draft sent later stays unread",()=>{
  const watermark=new Date("2026-08-30T10:00:00Z");
  assert.equal(isMetaMessageReadAt(new Date("2026-08-30T09:59:59Z"),watermark),true);
  assert.equal(isMetaMessageReadAt(new Date("2026-08-30T10:00:01Z"),watermark),false);
  assert.equal(isMetaMessageReadAt(null,watermark),false);
});

test("normalizes Facebook message echoes delivered through standby", () => {
  const [echo] = normalizeMetaEchoMessages({ object: "page", entry: [{ id: "page-1", standby: [{ sender: { id: "page-1" }, recipient: { id: "psid-1" }, timestamp: 85, message: { mid: "standby-echo-mid", is_echo: true, text: "Ответ из Business Suite" } }] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(echo)), {
    channel: "FACEBOOK",
    externalRecipientId: "psid-1",
    externalMessageId: "standby-echo-mid",
    content: "Ответ из Business Suite",
    receiverId: "page-1",
    receivedAt: "1970-01-01T00:00:00.085Z",
    metadata: { messageType: "text" },
  });
});

test("safe webhook log summaries pseudonymize both sender and recipient identifiers", () => {
  const safe = safeMetaWebhookLogSummary({ object: "page", entryId: "page-1", eventType: "message_echo", senderId: "page-1", recipientId: "customer-igsid", mid: "mid-1", hasText: true, attachmentCount: 0, attachmentTypes: [], isEcho: true, isTest: false });
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes("customer-igsid"), false);
  assert.equal(serialized.includes('"senderId"'), false);
  assert.equal(serialized.includes('"recipientId"'), false);
  assert.match(safe.senderRef, /^[a-f0-9]{12}$/);
  assert.match(safe.recipientRef, /^[a-f0-9]{12}$/);
});

test("normalizes Instagram message echoes from the shared messages subscription", () => {
  const [echo] = normalizeMetaEchoMessages({ object: "instagram", entry: [{ id: "ig-business-1", messaging: [{ sender: { id: "ig-business-1" }, recipient: { id: "igsid-1" }, timestamp: 84, message: { mid: "ig-echo-mid", is_echo: true, attachments: [{ type: "video", payload: { url: "https://cdn.example/reply.mp4" } }] } }] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(echo)), {
    channel: "INSTAGRAM",
    externalRecipientId: "igsid-1",
    externalMessageId: "ig-echo-mid",
    content: "[Видео]",
    receiverId: "ig-business-1",
    receivedAt: "1970-01-01T00:00:00.084Z",
    metadata: { messageType: "video", attachmentTypes: ["video"], attachments: [{ type: "video", url: "https://cdn.example/reply.mp4" }] },
  });
});

test("echo reconciliation preserves CRM provenance, records Meta chronology and is retry-idempotent", () => {
  const at = new Date("2026-08-29T10:20:30.000Z");
  const crm = mergeMetaEchoMetadata({ source: "CRM", requestId: "request-1" }, { messageType: "text" }, "page-1", at);
  assert.deepEqual(JSON.parse(JSON.stringify(crm)), { source: "CRM", requestId: "request-1", messageType: "text", receiverId: "page-1", provider: "META", metaEchoReceivedAt: at.toISOString() });
  assert.equal(metaEchoAlreadyProcessed(crm), true);
  assert.equal(mergeMetaEchoMetadata({}, { messageType: "image" }, "ig-1", at).source, "META");
  assert.equal(metaEchoAlreadyProcessed({}), false);
});

test("normalizes control events without creating inbound messages", () => {
  const payload = { object: "page", entry: [{ id: "page-1", messaging: [
    { recipient: { id: "page-1" }, timestamp: 10, delivery: { mids: ["m-1", "m-2"] } },
    { recipient: { id: "page-1" }, timestamp: 11, message_edit: { mid: "m-3", text: "Исправленный текст" } },
    { recipient: { id: "page-1" }, timestamp: 12, reaction: { mid: "m-4", reaction: "love" } },
  ] }] };
  assert.equal(normalizeMetaWebhook(payload).length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(normalizeMetaControlEvents(payload).map(x => [x.eventType, x.externalMessageId, x.editedText]))), [
    ["delivery", "m-1", null], ["delivery", "m-2", null], ["message_edit", "m-3", "Исправленный текст"], ["reaction", "m-4", null],
  ]);
});

test("control events retain account and counterparty scope and fail closed when a mid is ambiguous", () => {
  const [event] = normalizeMetaControlEvents({ object: "page", entry: [{ id: "page-1", messaging: [{ sender: { id: "psid-1" }, recipient: { id: "page-1" }, timestamp: 10, reaction: { mid: "same-mid", reaction: "love" } }] }] });
  assert.equal(event.receiverId, "page-1");
  assert.equal(event.externalPartyId, "psid-1");
  const page1 = { id: "m1", conversationExternalId: "page-1:psid-1" };
  const page2 = { id: "m2", conversationExternalId: "page-2:psid-1" };
  assert.equal(uniqueMetaControlTarget([page1, page2], "page-1"), page1);
  assert.equal(uniqueMetaControlTarget([page1, { id: "m3", conversationExternalId: "page-1:psid-2" }], "page-1"), undefined);
  assert.equal(uniqueMetaControlTarget([page1], undefined), undefined);
});

test("verifies the exact raw body with X-Hub-Signature-256", () => {
  const raw = Buffer.from('{"object":"page"}'), secret = "meta-app-secret";
  const crypto = require("node:crypto");
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyMetaSignature(raw, signature, secret), true);
  assert.equal(verifyMetaSignature(Buffer.from("changed"), signature, secret), false);
  assert.equal(verifyMetaSignature(raw, "sha256=bad", secret), false);
});
