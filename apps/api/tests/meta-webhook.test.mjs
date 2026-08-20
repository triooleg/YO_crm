import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const source = await readFile(new URL("../src/communications/meta-webhook.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} }, require = createRequire(import.meta.url);
vm.runInNewContext(javascript, { module, exports: module.exports, require, Buffer });
const { normalizeMetaWebhook, verifyMetaSignature } = module.exports;

test("normalizes Facebook, Instagram and WhatsApp into one inbound contract", () => {
  const facebook = normalizeMetaWebhook({ object: "page", entry: [{ messaging: [{ sender: { id: "fb-1" }, timestamp: 1000, message: { mid: "fb-mid", text: "Facebook text" } }] }] });
  const instagram = normalizeMetaWebhook({ object: "instagram", entry: [{ messaging: [{ sender: { id: "ig-1" }, timestamp: 2000, message: { mid: "ig-mid", attachments: [{ type: "image" }] } }] }] });
  const whatsapp = normalizeMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { contacts: [{ wa_id: "3801", profile: { name: "Anna" } }], messages: [{ id: "wa-mid", from: "3801", timestamp: "3", type: "text", text: { body: "WhatsApp text" } }] } }] }] });
  assert.deepEqual(JSON.parse(JSON.stringify(facebook.map(x => [x.channel, x.externalSenderId, x.externalMessageId, x.content]))), [["FACEBOOK", "fb-1", "fb-mid", "Facebook text"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(instagram.map(x => [x.channel, x.externalSenderId, x.externalMessageId, x.content]))), [["INSTAGRAM", "ig-1", "ig-mid", "[Фото]"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(whatsapp.map(x => [x.channel, x.externalSenderId, x.externalMessageId, x.displayName, x.content]))), [["WHATSAPP", "3801", "wa-mid", "Anna", "WhatsApp text"]]);
});

test("Meta carries configured receiver ids for scope validation",()=>{
  const [facebook]=normalizeMetaWebhook({object:"page",entry:[{id:"page-1",messaging:[{sender:{id:"s"},message:{mid:"m",text:"x"}}]}]});
  const [whatsapp]=normalizeMetaWebhook({object:"whatsapp_business_account",entry:[{changes:[{value:{metadata:{phone_number_id:"phone-1"},messages:[{id:"w",from:"1",type:"text",text:{body:"x"}}]}}]}]});
  assert.equal(facebook.receiverId,"page-1");assert.equal(whatsapp.receiverId,"phone-1");
});

test("ignores delivery statuses and outgoing echo events", () => {
  assert.equal(normalizeMetaWebhook({ object: "page", entry: [{ messaging: [{ sender: { id: "x" }, message: { mid: "m", text: "echo", is_echo: true } }] }] }).length, 0);
  assert.equal(normalizeMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { statuses: [{ id: "status" }] } }] }] }).length, 0);
});

test("verifies the exact raw body with X-Hub-Signature-256", () => {
  const raw = Buffer.from('{"object":"page"}'), secret = "meta-app-secret";
  const crypto = require("node:crypto");
  const signature = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  assert.equal(verifyMetaSignature(raw, signature, secret), true);
  assert.equal(verifyMetaSignature(Buffer.from("changed"), signature, secret), false);
  assert.equal(verifyMetaSignature(raw, "sha256=bad", secret), false);
});
