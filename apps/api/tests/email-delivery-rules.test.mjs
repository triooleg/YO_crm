import test from "node:test";
import assert from "node:assert/strict";
import { blocksEmailDelivery, canReleaseEmailDelivery, emailConnectionSettingsChanged, emailSignedContent } from "../src/communications/email-delivery-rules.ts";
import { runMetaSendOnce } from "../src/communications/meta-send.ts";

test("active and uncertain Gmail delivery both block a duplicate send", () => {
  assert.equal(blocksEmailDelivery("PENDING"), true);
  assert.equal(blocksEmailDelivery("UNCERTAIN"), true);
  assert.equal(blocksEmailDelivery("FAILED"), false);
});

test("only a provider-uncertain Gmail delivery can be manually released", () => {
  assert.equal(canReleaseEmailDelivery("PENDING"), false);
  assert.equal(canReleaseEmailDelivery("UNCERTAIN"), true);
  assert.equal(canReleaseEmailDelivery("SENT"), false);
});

test("provider success followed by persistence failure enters the uncertainty recovery path",async()=>{let uncertainMessageId="";await assert.rejects(()=>runMetaSendOnce({reserve:async()=>({kind:"NEW"}),deliver:async()=>({messageId:"gmail-accepted"}),persistSuccess:async()=>{throw new Error("database unavailable")},persistSuccessFailure:async result=>{uncertainMessageId=result.messageId;throw new Error("manual resolution required")},persistFailure:async()=>{throw new Error("wrong failure path")},pendingError:()=>new Error("pending")}),/manual resolution required/);assert.equal(uncertainMessageId,"gmail-accepted")});

test("configured Gmail signature is appended once and only for non-empty signatures", () => {
  assert.equal(emailSignedContent("Hello", "Best regards,\nYOLeotard"), "Hello\n\nBest regards,\nYOLeotard");
  assert.equal(emailSignedContent("Hello\n\nBest regards,\nYOLeotard", "Best regards,\nYOLeotard"), "Hello\n\nBest regards,\nYOLeotard");
  assert.equal(emailSignedContent("Hello", "   "), "Hello");
});

test("signature-only save preserves Gmail verification",()=>{const current={enabled:true,username:"yoleotard@gmail.com"};assert.equal(emailConnectionSettingsChanged(current,[["signature","YOLeotard"]],false),false);assert.equal(emailConnectionSettingsChanged(current,[["username","other@gmail.com"]],false),true);assert.equal(emailConnectionSettingsChanged(current,[["signature","YOLeotard"]],true),true)});
