import assert from "node:assert/strict";
import test from "node:test";
import { chatwootEchoDecision, chatwootMultipartBody, remoteMediaUrl } from "../src/communications/chatwoot-delivery.ts";

const event = {
  channel: "CHATWOOT",
  direction: "OUTBOUND",
  externalSenderId: "contact-1",
  externalMessageId: "chatwoot:2:1838",
  content: "[Фото]",
  receivedAt: new Date("2026-08-31T10:00:00.000Z"),
  accountId: "2",
  inboxId: "2",
  metadata: { messageType: "image", chatwootConversationId: "115", attachments: [{ type: "image", url: "https://chatwoot.yoleotard.com/rails/active_storage/photo", mimeType: "image/jpeg" }] },
};

test("Chatwoot echo preserves CRM metadata, stores provider snapshot and is retry-idempotent", () => {
  const localAttachment = { type: "image", url: "/api/communications/files/local.jpg", path: "local.jpg" };
  const existing = { source: "CRM", provider: "CHATWOOT", attachments: [localAttachment], chatwootConversationId: "115" };
  const first = chatwootEchoDecision(existing, event.metadata, "hash-1", { seenAt: event.receivedAt.toISOString(), accountId: "2", inboxId: "2" });
  assert.equal(first.kind, "SYNC");
  assert.equal(first.metadata.source, "CRM");
  assert.deepEqual(first.metadata.attachments, [localAttachment]);
  assert.deepEqual(first.metadata.chatwootWebhook, event.metadata);
  assert.equal(first.metadata.chatwootWebhookPayloadHash, "hash-1");
  assert.deepEqual(chatwootEchoDecision(first.metadata, event.metadata, "hash-1", { seenAt: event.receivedAt.toISOString() }), { kind: "UNCHANGED" });
});

test("Chatwoot media accepts only the exact configured origin through every redirect", () => {
  const origin = "https://chatwoot.yoleotard.com";
  assert.equal(remoteMediaUrl(`${origin}/rails/active_storage/photo`, origin)?.origin, origin);
  assert.equal(remoteMediaUrl("https://chatwoot.yoleotard.com:8443/private", origin), undefined);
  assert.equal(remoteMediaUrl("https://127.0.0.1/private", origin), undefined);
  const firstRedirect = remoteMediaUrl(`${origin}/redirect`, origin);
  assert.ok(firstRedirect);
  assert.equal(remoteMediaUrl(new URL("https://internal.example/file", firstRedirect).toString(), origin), undefined);
});

test("Chatwoot multipart includes text and one attachment in the same provider request", async () => {
  const form = chatwootMultipartBody("Текст вместе с фото", { bytes: new Uint8Array([1, 2, 3]), name: "photo.jpg", mimeType: "image/jpeg" });
  assert.equal(form.get("message_type"), "outgoing");
  assert.equal(form.get("private"), "false");
  assert.equal(form.get("content"), "Текст вместе с фото");
  const file = form.get("attachments[]");
  assert.ok(file instanceof Blob);
  assert.equal(file.type, "image/jpeg");
  assert.equal(file.size, 3);
  assert.equal(file.name, "photo.jpg");
});
