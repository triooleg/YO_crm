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
const { legacyConversationMatchesReceiver, metaConversationExternalId, metaProfileTargets, normalizeMetaControlEvents, normalizeMetaWebhook, summarizeMetaWebhook, verifyMetaSignature } = module.exports;

test("normalizes Facebook, Instagram and WhatsApp into one inbound contract", () => {
  const facebook = normalizeMetaWebhook({ object: "page", entry: [{ messaging: [{ sender: { id: "fb-1" }, timestamp: 1000, message: { mid: "fb-mid", text: "Facebook text" } }] }] });
  const instagram = normalizeMetaWebhook({ object: "instagram", entry: [{ messaging: [{ sender: { id: "ig-1" }, timestamp: 2000, message: { mid: "ig-mid", attachments: [{ type: "image" }] } }] }] });
  const whatsapp = normalizeMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { contacts: [{ wa_id: "3801", profile: { name: "Anna" } }], messages: [{ id: "wa-mid", from: "3801", timestamp: "3", type: "text", text: { body: "WhatsApp text" } }] } }] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(facebook.map(x => [x.channel, x.externalSenderId, x.externalMessageId, x.content]))), [["FACEBOOK", "fb-1", "fb-mid", "Facebook text"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(instagram.map(x => [x.channel, x.externalSenderId, x.externalMessageId, x.content]))), [["INSTAGRAM", "ig-1", "ig-mid", "[Фото]"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(whatsapp.map(x => [x.channel, x.externalSenderId, x.externalMessageId, x.displayName, x.content]))), [["WHATSAPP", "3801", "wa-mid", "Anna", "WhatsApp text"]]);
});

test("Facebook sender profile is resolved and technical lead names are upgraded",()=>{
  assert.match(service,/fields:"name,first_name,last_name"/);
  assert.match(service,/META_PROFILE_LOOKUP_FAILED/);
  assert.match(service,/Facebook\|Instagram/);
});

test("Meta carries configured receiver ids for scope validation",()=>{
  const [facebook]=normalizeMetaWebhook({object:"page",entry:[{id:"page-1",messaging:[{sender:{id:"s"},message:{mid:"m",text:"x"}}]}]});
  const [whatsapp]=normalizeMetaWebhook({object:"whatsapp_business_account",entry:[{changes:[{value:{metadata:{phone_number_id:"phone-1"},messages:[{id:"w",from:"1",type:"text",text:{body:"x"}}]}}]}]});
  assert.equal(facebook.receiverId,"page-1");assert.equal(whatsapp.receiverId,"phone-1");
});

test("scopes Messenger conversations by Page ID and PSID", () => {
  assert.equal(metaConversationExternalId("page-a", "same-psid"), "page-a:same-psid");
  assert.equal(metaConversationExternalId("page-b", "same-psid"), "page-b:same-psid");
  assert.notEqual(metaConversationExternalId("page-a", "same-psid"), metaConversationExternalId("page-b", "same-psid"));
});

test("profile enrichment keeps identical sender IDs isolated by Facebook Page",()=>{
 const targets=metaProfileTargets([{channel:"FACEBOOK",receiverId:"page-a",externalSenderId:"same",externalMessageId:"1",content:"a",receivedAt:new Date(),metadata:{messageType:"text"}},{channel:"FACEBOOK",receiverId:"page-b",externalSenderId:"same",externalMessageId:"2",content:"b",receivedAt:new Date(),metadata:{messageType:"text"}}]);
 assert.deepEqual(JSON.parse(JSON.stringify(targets)),[{receiverId:"page-a",senderId:"same"},{receiverId:"page-b",senderId:"same"}]);
 assert.match(service,/externalId_channel/);
});

test("migrates a legacy PSID conversation only when its saved receiver matches the Page", () => {
  assert.equal(legacyConversationMatchesReceiver({ receiverId: "page-a" }, "page-a"), true);
  assert.equal(legacyConversationMatchesReceiver({ receiverId: "page-a" }, "page-b"), false);
  assert.equal(legacyConversationMatchesReceiver({}, "page-a"), false);
  assert.equal(legacyConversationMatchesReceiver(null, "page-a"), false);
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

test("verifies the exact raw body with X-Hub-Signature-256", () => {
  const raw = Buffer.from('{"object":"page"}'), secret = "meta-app-secret";
  const crypto = require("node:crypto");
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyMetaSignature(raw, signature, secret), true);
  assert.equal(verifyMetaSignature(Buffer.from("changed"), signature, secret), false);
  assert.equal(verifyMetaSignature(raw, "sha256=bad", secret), false);
});
