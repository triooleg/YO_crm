import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTargetModule } from "./website-test-loader.mjs";

const { CommunicationsService } = loadTargetModule("communications/communications.service.ts");
const { normalizeMetaEchoMessages } = loadTargetModule("communications/meta-webhook.ts");
const requestId = "4b907117-7ea5-4798-8da5-80c3257af963";
const actor = { id: "staff" };
const aiRunId = "synthetic-ai-reply-run-id";
const path = "11111111-1111-4111-8111-111111111111.pdf";
const pdf = Buffer.from("%PDF-1.4\nsynthetic attachment\n%%EOF");
const attachment = { path, name: "invoice.pdf", mimeType: "application/pdf" };
const message = {
  id: "sent", conversationId: "chat", direction: "OUTBOUND", status: "SENT",
  authorId: actor.id, content: attachment.name, replyToMessageId: null, metadata: {},
};
const upload = {
  path, createdById: actor.id, originalName: attachment.name, mimeType: attachment.mimeType,
  sizeBytes: pdf.length, claimedAt: new Date(), clientRequestId: null, messageId: message.id,
};
const attempt = { status: "SENT", clientId: "buyer", conversationId: "chat", messageId: message.id };

function fixture(t, channel, { savedAttempt = attempt, stored = upload, savedMessage = message } = {}) {
  const provider = t.mock.fn(() => assert.fail("replay must not call the provider"));
  t.mock.method(globalThis, "fetch", provider);
  const db = {
    client: { findFirst: async ({ where }) => where.id === "buyer" ? { source: channel, email: "buyer@example.test" } : null },
    conversation: { findFirst: async ({ where }) => {
      assert.deepEqual(where, { clientId: "buyer", channel, archivedAt: null,
        ...(channel === "EMAIL" ? { externalId: { equals: "buyer@example.test", mode: "insensitive" } } : {}),
      });
      return { id: "chat", externalId: "100:200", messages: [{ metadata: { chatwootConversationId: "42" } }] };
    } },
    messageDeliveryAttempt: { findUnique: async ({ where }) => where.clientRequestId === requestId ? savedAttempt : null },
    communicationAttachment: { findUnique: async ({ where }) => where.path === stored.path ? stored : null },
    message: {
      findUnique: async ({ where }) => where.id === savedMessage.id ? savedMessage : null,
      findFirst: async () => null,
    },
    $executeRaw: async () => {},
    $transaction: async callback => callback(db),
  };
  const service = new CommunicationsService(db, { send: provider });
  service.sectionValues = async () => ({
    enabled: true, baseUrl: "https://chat.example.test", accountId: "1", pageId: "100", whatsappPhoneNumberId: "100",
  });
  service.secretValue = () => "synthetic-token";
  service.sendChatwootProviderMessage = provider;
  service.metaGraph = provider;
  return { service, db, provider, input: { channel, action: "SEND", clientRequestId: requestId, attachment } };
}

for (const channel of ["CHATWOOT", "WHATSAPP"]) {
  test(`${channel} replays a committed PDF after the upload reservation was cleared`, async t => {
    const { service, provider, input } = fixture(t, channel);
    assert.deepEqual(await service.send("buyer", input, actor), { ...message, channel });
    assert.equal(provider.mock.callCount(), 0);
  });

  test(`${channel} rejects a completed attachment replay outside its original scope`, async t => {
    const cases = [
      [{ savedAttempt: { ...attempt, clientId: "other" } }, {}, actor],
      [{ savedAttempt: { ...attempt, conversationId: "other" } }, {}, actor],
      [{}, {}, { id: "other" }],
      [{ stored: { ...upload, messageId: "other" } }, {}, actor],
      [{}, { attachment: { ...attachment, name: "other.pdf" } }, actor],
      [{}, { content: "changed" }, actor],
      [{ savedMessage: { ...message, conversationId: "other" } }, {}, actor],
    ];
    for (const [data, overrides, user] of cases) {
      const { service, provider, input } = fixture(t, channel, data);
      const status = channel === "WHATSAPP" && user !== actor ? 400 : 409;
      await assert.rejects(service.send("buyer", { ...input, ...overrides }, user), { status });
      assert.equal(provider.mock.callCount(), 0);
    }
  });
}

async function installTestUpload(t) {
  const previous = { UPLOADS_DIR: process.env.UPLOADS_DIR, SETTINGS_ENCRYPTION_KEY: process.env.SETTINGS_ENCRYPTION_KEY };
  const root = await mkdtemp(join(tmpdir(), "crm-attachment-replay-"));
  const directory = join(root, "communication-files");
  await mkdir(directory);
  await writeFile(join(directory, path), pdf);
  process.env.UPLOADS_DIR = root;
  process.env.SETTINGS_ENCRYPTION_KEY = "synthetic-replay-key";
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await unlink(join(directory, path));
    await rmdir(directory);
    await rmdir(root);
  });
}

for (const channel of ["FACEBOOK", "WHATSAPP"]) {
  test(`${channel} replays a normal committed PDF with its retained upload reservation`, async t => {
    await installTestUpload(t);

    const { service, db, provider, input } = fixture(t, channel, { stored: { ...upload, clientRequestId: requestId } });
    if (channel === "WHATSAPP") {
      db.aiResponseFeedback = { findFirst: async ({ where }) =>
        where.aiRunId === aiRunId && where.sentMessageId === message.id && where.accepted === true &&
        where.aiRun.clientId === "buyer" && where.aiRun.conversationId === "chat" ? { id: "feedback" } : null,
      };
      input.aiRunId = aiRunId;
    }
    assert.deepEqual(await service.send("buyer", input, actor), { ...message, channel });
    if (channel === "WHATSAPP") {
      await assert.rejects(service.send("buyer", { ...input, aiRunId: "other-synthetic-ai-reply" }, actor), { status: 400 });
    }
    assert.equal(provider.mock.callCount(), 0);
  });
}

test("Chatwoot replays the submitted PDF request when the committed provider content and reply differ", async t => {
  await installTestUpload(t);
  const { service, db, input } = fixture(t, "CHATWOOT");
  let currentAttempt;
  let currentMessage;
  let currentUpload = { ...upload, claimedAt: null, messageId: null };
  db.messageDeliveryAttempt = {
    findUnique: async ({ where }) => where.clientRequestId === requestId ? currentAttempt : null,
    findFirst: async () => null,
    create: async ({ data }) => { currentAttempt = data; return data; },
    update: async ({ data }) => Object.assign(currentAttempt, data),
  };
  db.communicationAttachment = {
    findUnique: async ({ where }) => where.path === path ? currentUpload : null,
    updateMany: async ({ where, data }) => {
      assert.deepEqual(where, { path, claimedAt: null, clientRequestId: null, messageId: null });
      assert.equal(currentUpload.claimedAt, null);
      assert.equal(currentUpload.clientRequestId, null);
      currentUpload = { ...currentUpload, ...data };
      return { count: 1 };
    },
    update: async ({ data }) => {
      currentUpload = { ...currentUpload, ...data };
      return currentUpload;
    },
  };
  db.message = {
    findUnique: async ({ where }) => where.id === message.id ? currentMessage : null,
    upsert: async ({ create }) => {
      currentMessage = { id: message.id, ...create };
      return currentMessage;
    },
  };
  const feedback = { id: "feedback", accepted: null, sentMessageId: null };
  db.aiResponseFeedback = {
    findFirst: async ({ where }) =>
      where.aiRunId === aiRunId && where.accepted === feedback.accepted && where.sentMessageId === feedback.sentMessageId ? feedback : null,
    updateMany: t.mock.fn(async ({ data }) => { Object.assign(feedback, data); return { count: 1 }; }),
    update: t.mock.fn(async ({ data }) => Object.assign(feedback, data)),
  };
  db.activity = { create: t.mock.fn(async () => ({})) };
  db.auditLog = { create: t.mock.fn(async () => ({})) };
  const deliver = t.mock.method(service, "sendChatwootProviderMessage", async (_settings, recipient, content, file) => {
    assert.equal(recipient, "42");
    assert.equal(content, "Original invoice caption");
    assert.equal(file.path, path);
    return { id: 99, content: "Provider-normalized caption" };
  });

  const request = { ...input, aiRunId, content: "Original invoice caption", replyToMessageId: "requested-inbox-reply-id" };
  const sent = await service.send("buyer", request, actor);
  assert.equal(sent.content, "Provider-normalized caption");
  assert.equal(sent.replyToMessageId ?? null, null);
  assert.equal(currentAttempt.status, "SENT");
  assert.equal(currentUpload.clientRequestId, null);
  assert.equal(currentUpload.messageId, sent.id);
  assert.equal(feedback.accepted, true);
  assert.equal(feedback.sentMessageId, sent.id);
  assert.deepEqual(await service.send("buyer", request, actor), sent);
  await assert.rejects(service.send("buyer", { ...request, aiRunId: "other-synthetic-ai-reply" }, actor), { status: 409 });
  await assert.rejects(service.send("buyer", { ...request, content: sent.content }, actor), { status: 409 });
  await assert.rejects(service.send("buyer", { ...request, replyToMessageId: undefined }, actor), { status: 409 });
  assert.equal(deliver.mock.callCount(), 1);
  assert.equal(db.aiResponseFeedback.updateMany.mock.callCount(), 1);
  assert.equal(db.aiResponseFeedback.update.mock.callCount(), 1);
  assert.equal(db.activity.create.mock.callCount(), 1);
  assert.equal(db.auditLog.create.mock.callCount(), 1);
});

test("WhatsApp replays an attachment after reconciling a normalized echo without a filename", async t => {
  await installTestUpload(t);
  const { service, db, input } = fixture(t, "WHATSAPP");
  const providerId = "wamid.synthetic-document";
  const raw = {
    object: "whatsapp_business_account", entry: [{ changes: [{
      field: "smb_message_echoes", value: {
        metadata: { phone_number_id: "100" },
        message_echoes: [{ from: "100", to: "200", id: providerId, timestamp: "1504902988",
          type: "document", document: { id: "media-1", mime_type: "application/pdf" } }],
      },
    }] }],
  };
  const [echo] = normalizeMetaEchoMessages(raw);
  assert.equal(echo.content, "[Документ]");

  let currentAttempt, currentMessage, uncertainty;
  let currentUpload = { ...upload, claimedAt: null, messageId: null };
  db.messageDeliveryAttempt = {
    findUnique: async ({ where }) => where.clientRequestId === requestId ? currentAttempt : null,
    findFirst: async ({ where }) => where.id === currentAttempt?.id && currentAttempt?.status === "UNCERTAIN" ? currentAttempt : null,
    create: async ({ data }) => { currentAttempt = { id: "attempt", ...data }; return currentAttempt; },
    update: async ({ data }) => Object.assign(currentAttempt, data),
  };
  db.communicationAttachment = {
    findUnique: async ({ where }) => where.path === path ? currentUpload : null,
    updateMany: async ({ data }) => {
      currentUpload = { ...currentUpload, ...data };
      return { count: 1 };
    },
  };
  db.message = {
    findUnique: async ({ where }) =>
      currentMessage && (where.id === currentMessage.id || where.conversationId_externalId?.externalId === currentMessage.externalId) ? currentMessage : null,
    upsert: async () => { throw new Error("synthetic write failure after provider acceptance"); },
    create: async ({ data }) => { currentMessage = { id: message.id, ...data }; return currentMessage; },
  };
  db.appSetting = {
    findFirst: async ({ where }) => uncertainty?.value.providerMessageId === where.value.equals ? uncertainty : null,
    upsert: async ({ create }) => { uncertainty = create; return uncertainty; },
    deleteMany: async () => { uncertainty = undefined; return { count: 1 }; },
  };
  db.conversation.findUnique = async () => ({ id: "chat", clientId: "buyer", externalId: "100:200", channel: "WHATSAPP" });
  db.conversation.update = async () => ({});
  db.messageAttachment = { create: async () => ({}) };
  db.activity = { create: async () => ({}) };
  db.auditLog = { create: async () => ({}) };
  service.whatsappGraph = t.mock.fn(async () => ({ messages: [{ id: providerId }] }));

  await assert.rejects(service.send("buyer", input, actor), { status: 409 });
  assert.equal(currentAttempt.status, "UNCERTAIN");
  assert.equal(await service.persistMetaEcho(echo, raw), true);
  assert.equal(currentAttempt.status, "SENT");
  assert.equal(currentUpload.clientRequestId, null);
  assert.equal(currentMessage.content, "[Документ]");
  assert.deepEqual(await service.send("buyer", input, actor), { ...currentMessage, channel: "WHATSAPP" });
  await assert.rejects(service.send("buyer", { ...input, content: "[Документ]" }, actor), { status: 409 });
  assert.equal(service.whatsappGraph.mock.callCount(), 1);
});

for (const channel of ["EMAIL", "CHATWOOT", "WHATSAPP"]) {
  test(`${channel} checks unused AI feedback under the reservation lock before a fresh send`, async t => {
    const { service, db, provider, input } = fixture(t, channel, { savedAttempt: null });
    let locked = false;
    db.$executeRaw = async () => { locked = true; };
    db.messageDeliveryAttempt.findFirst = async () => null;
    const check = t.mock.fn(async ({ where }) => {
      assert.equal(locked, true);
      assert.deepEqual(where, {
        aiRunId, sentMessageId: null, accepted: null,
        aiRun: { clientId: "buyer", conversationId: "chat", operation: "REPLY", status: "COMPLETED" },
      });
      return null;
    });
    db.aiResponseFeedback = { findFirst: check };
    await assert.rejects(service.send("buyer", { ...input, attachment: undefined, content: "Fresh AI text", aiRunId }, actor), { status: 400 });
    assert.equal(check.mock.callCount(), 1);
    assert.equal(provider.mock.callCount(), 0);
  });
}
