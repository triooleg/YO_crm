import test from "node:test";
import assert from "node:assert/strict";
import { blocksEmailDelivery, canReleaseEmailDelivery } from "../src/communications/email-delivery-rules.ts";
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
