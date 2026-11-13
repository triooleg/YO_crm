import test from "node:test";
import assert from "node:assert/strict";
import { loadTargetModule } from "./website-test-loader.mjs";

const { CommunicationsService } = loadTargetModule("communications/communications.service.ts");
const requestId = "4b907117-7ea5-4798-8da5-80c3257af963";
const actor = { id: "staff" };
const input = {
  channel: "EMAIL", action: "SEND", clientRequestId: requestId,
  attachment: { path: "a.pdf", name: "invoice.pdf", mimeType: "application/pdf" },
};
const message = {
  id: "sent", conversationId: "mail", direction: "OUTBOUND", status: "SENT",
  authorId: actor.id, content: "invoice.pdf", metadata: { provider: "GMAIL" },
};
const stored = {
  path: "a.pdf", createdById: actor.id, originalName: "invoice.pdf", mimeType: "application/pdf",
  claimedAt: new Date(), clientRequestId: null, messageId: message.id,
};
const attempt = { status: "SENT", clientId: "buyer", conversationId: "mail", messageId: message.id };

function service({ savedAttempt = attempt, savedMessage = message, upload = stored, feedback } = {}) {
  const db = {
    client: { findFirst: async ({ where }) => where.id === "buyer" ? { email: "buyer@example.test" } : null },
    conversation: { findFirst: async ({ where }) => {
      assert.deepEqual(where, { clientId: "buyer", channel: "EMAIL", externalId: { equals: "buyer@example.test", mode: "insensitive" }, archivedAt: null });
      return { id: "mail" };
    } },
    messageDeliveryAttempt: { findUnique: async ({ where }) => where.clientRequestId === requestId ? savedAttempt : null },
    communicationAttachment: { findUnique: async ({ where }) => where.path === upload.path ? upload : null },
    message: {
      findUnique: async ({ where }) => where.id === savedMessage.id ? savedMessage : null,
      findFirst: async () => null,
    },
    aiResponseFeedback: { findFirst: async ({ where }) => feedback?.(where) ?? null },
    $executeRaw: async () => {},
    $transaction: async callback => callback(db),
  };
  return new CommunicationsService(db, { send: async () => assert.fail("replay must never call Gmail") });
}

test("Gmail returns the persisted PDF message after losing the successful send response", async () => {
  assert.deepEqual(await service().send("buyer", input, actor), { ...message, channel: "EMAIL" });
});

test("Gmail cannot replay a completed PDF attempt outside its original scope", async () => {
  for (const [label, fixture, request, user] of [
    ["other client", { savedAttempt: { ...attempt, clientId: "other" } }, input, actor],
    ["other conversation", { savedAttempt: { ...attempt, conversationId: "other" } }, input, actor],
    ["other actor", {}, input, { id: "other" }],
    ["other upload", { upload: { ...stored, messageId: "other" } }, input, actor],
    ["other request id", {}, { ...input, clientRequestId: "3c907117-7ea5-4798-8da5-80c3257af963" }, actor],
    ["other path", {}, { ...input, attachment: { ...input.attachment, path: "b.pdf" } }, actor],
    ["changed content", {}, { ...input, content: "different" }, actor],
    ["other reply", {}, { ...input, replyToMessageId: "another-message" }, actor],
    ["other message conversation", { savedMessage: { ...message, conversationId: "other" } }, input, actor],
  ]) {
    await assert.rejects(() => service(fixture).send("buyer", request, user), error => [400, 409].includes(error.status), label);
  }
});

test("Gmail replays a completed PDF after the original AI feedback was consumed", async () => {
  const aiRunId = "synthetic-ai-reply-run-id";
  const replay = service({ feedback: where =>
    where.aiRunId === aiRunId && where.sentMessageId === message.id && where.accepted === true &&
    where.aiRun.clientId === "buyer" && where.aiRun.conversationId === "mail" ? { id: "feedback" } : null,
  });
  assert.deepEqual(await replay.send("buyer", { ...input, aiRunId }, actor), { ...message, channel: "EMAIL" });
  await assert.rejects(replay.send("buyer", { ...input, aiRunId: "other-synthetic-ai-reply" }, actor), { status: 400 });
});
