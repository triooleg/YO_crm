import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const source = await readFile(new URL("../src/communications/meta-delivery.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} }, require = createRequire(import.meta.url);
vm.runInNewContext(javascript, { module, exports: module.exports, require });
const { confirmMetaPageSubscription, isMetaAccessToken, metaDeliveryStatus, metaChannelDeliveryStatus, resolveInstagramWebhookReceiver } = module.exports;

test("successful Meta Page subscription produces verified state and safe audit", () => {
  const result = confirmMetaPageSubscription({ pageId: "page-1", appId: "app-1", page: { id: "page-1", name: "YOLeotard" }, subscriptions: [{ id: "app-1", subscribed_fields: ["messages", "standby", "message_reads"] }], verifiedAt: "2026-08-21T12:00:00.000Z" });
  assert.deepEqual(JSON.parse(JSON.stringify(result.settings)), { subscriptionVerifiedAt: "2026-08-21T12:00:00.000Z", pageName: "YOLeotard" });
  assert.deepEqual(JSON.parse(JSON.stringify(result.auditAfter)), { deliveryVerified: true, pageId: "page-1", subscribedFields: ["messages", "standby", "message_reads"] });
  assert.equal(JSON.stringify(result).includes("token"), false);
});

test("missing messages subscription fails before any verified mutation is produced", () => {
  assert.throws(() => confirmMetaPageSubscription({ pageId: "page-1", appId: "app-1", page: { id: "page-1" }, subscriptions: [{ id: "app-1", subscribed_fields: ["message_reads"] }], verifiedAt: "now" }), /MESSAGES_NOT_SUBSCRIBED/);
});

test("missing standby subscription cannot claim full Messenger delivery", () => {
  assert.throws(() => confirmMetaPageSubscription({ pageId: "page-1", appId: "app-1", page: { id: "page-1" }, subscriptions: [{ id: "app-1", subscribed_fields: ["messages", "message_reads"] }], verifiedAt: "now" }), /STANDBY_NOT_SUBSCRIBED/);
});

test("unsafe or disabled Meta delivery is never reported ready", () => {
  assert.equal(isMetaAccessToken("EAAExampleAccessToken"), true);
  assert.equal(isMetaAccessToken("random-webhook-secret-32-chars"), false);
  assert.equal(metaDeliveryStatus({ enabled: true, ready: true, verified: true, receiving: true, verifyTokenUnsafe: true }), "VERIFY_TOKEN_UNSAFE");
  assert.equal(metaDeliveryStatus({ enabled: false, ready: false, verified: true, receiving: true, verifyTokenUnsafe: false }), "NOT_CONNECTED");
  assert.equal(metaDeliveryStatus({ enabled: true, ready: true, verified: false, receiving: false, verifyTokenUnsafe: false }), "NOT_VERIFIED");
});

test("Instagram is not reported connected merely because its identifier is saved", () => {
  assert.equal(metaChannelDeliveryStatus({ configured: true, verified: false, receiving: false }), "NOT_CONNECTED");
  assert.equal(metaChannelDeliveryStatus({ configured: true, verified: true, receiving: false }), "SUBSCRIBED");
  assert.equal(metaChannelDeliveryStatus({ configured: true, verified: true, receiving: true }), "RECEIVING");
});

test("Instagram webhook receiver is accepted only from the verified Page relationship",()=>{
  assert.equal(resolveInstagramWebhookReceiver({id:"page-1",instagram_business_account:{id:"17841407931852361",username:"yoleotard"}},"page-1","@YOLEOTARD"),"17841407931852361");
  assert.throws(()=>resolveInstagramWebhookReceiver({id:"page-2",instagram_business_account:{id:"17841407931852361",username:"yoleotard"}},"page-1","yoleotard"),/PAGE_TOKEN_MISMATCH/);
  assert.throws(()=>resolveInstagramWebhookReceiver({id:"page-1",instagram_business_account:{id:"17841407931852361",username:"other"}},"page-1","yoleotard"),/INSTAGRAM_USERNAME_MISMATCH/);
  assert.throws(()=>resolveInstagramWebhookReceiver({id:"page-1"},"page-1","yoleotard"),/INSTAGRAM_RELATIONSHIP_MISSING/);
  assert.throws(()=>resolveInstagramWebhookReceiver({id:"page-1",instagram_business_account:{id:"unsafe",username:"yoleotard"}},"page-1","yoleotard"),/INSTAGRAM_RECEIVER_INVALID/);
});
