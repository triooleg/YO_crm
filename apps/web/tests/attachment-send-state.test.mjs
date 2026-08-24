import test from "node:test";
import assert from "node:assert/strict";
import { prepareAttachmentAttempt, settleAttachmentAttempt, shouldResetAttachmentForClient } from "../lib/attachment-send-state.ts";

test("network retry keeps the same uploaded file and request id", () => {
  const first = prepareAttachmentAttempt({ file: "photo", uploaded: "stored" }, () => "request-1");
  const retry = prepareAttachmentAttempt(first.state, () => "request-2");
  assert.equal(retry.requestId, "request-1");
  assert.equal(retry.state.uploaded, "stored");
});

test("confirmed failure allows a fresh upload operation", () => {
  const failed = settleAttachmentAttempt({ file: "photo", uploaded: "stored", requestId: "request-1" }, "FAILED");
  assert.deepEqual(failed, { file: "photo" });
  const retry = prepareAttachmentAttempt(failed, () => "request-2");
  assert.equal(retry.requestId, "request-2");
  assert.equal(retry.state.attachmentDelivered, undefined);
});

test("successful attachment is marked delivered and is not sent twice", () => {
  const sent = settleAttachmentAttempt({ file: "photo", uploaded: "stored", requestId: "request-1" }, "SENT");
  assert.equal(sent.attachmentDelivered, true);
});

test("switching from client A to client B resets the attachment composer", () => {
  assert.equal(shouldResetAttachmentForClient("client-a", "client-b"), true);
  assert.equal(shouldResetAttachmentForClient("client-a", "client-a"), false);
  assert.equal(shouldResetAttachmentForClient(undefined, "client-a"), false);
});
