import test from "node:test";
import assert from "node:assert/strict";
import { ValidationPipe } from "@nestjs/common";
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
        ...(channel === "EMAIL" && where.externalId ? { externalId: { equals: "buyer@example.test", mode: "insensitive" } } : {}),
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
for (const [channel, lostResponse, usesDraft = true] of [
  ["EMAIL", false], ["CHATWOOT", false], ["WHATSAPP", false], ["CHATWOOT", true], ["CHATWOOT", true, false],
]) {
  test(`${channel} ${lostResponse ? (usesDraft ? "keeps a saved draft attachment on hold after a lost response" : "holds an unlinked attachment while allowing an independent reply") : "sends a saved draft and attachment in one delivery and safely replays it"}`, async t => {
    await installTestUpload(t);
    const { service, db, input } = fixture(t, channel, { savedAttempt: null });
    if (lostResponse) {
      t.mock.restoreAll();
      delete service.sendChatwootProviderMessage;
      t.mock.method(globalThis, "fetch", async (_url, init) => {
        assert.equal(init.body.get("content"), "Дизайн на согласование");
        assert.equal(init.body.get("attachments[]").name, attachment.name);
        throw new Error("Synthetic timeout after provider acceptance");
      });
    }
    const draftId = "saved-draft-with-attachment";
    const caption = "Дизайн на согласование";
    const oldAttachment = channel === "EMAIL" ? { ...attachment, path: "old.pdf" } : undefined;
    let releasedOldAttachment = false;
    let row = {
      id: draftId, direction: "OUTBOUND", status: "DRAFT", conversationId: "chat", content: caption,
      ...(oldAttachment ? { metadata: { attachments: [oldAttachment] } } : {}),
    };
    let currentAttempt;
    let currentUpload = { ...upload, claimedAt: null, messageId: null };
    db.message = {
      findFirst: async ({ where }) => where.id === draftId && where.status === row.status ? row : null,
      findUnique: async ({ where }) => where.id === row.id ? row : null,
      update: async ({ where, data }) => {
        assert.equal(where.id, draftId);
        return row = { ...row, ...data };
      },
    };
    db.messageDeliveryAttempt = {
      findUnique: async () => currentAttempt,
      findFirst: async () => null,
      create: async ({ data }) => currentAttempt = data,
      update: async ({ data }) => Object.assign(currentAttempt, data),
    };
    db.communicationAttachment = {
      findUnique: async ({ where }) => where.path === path ? currentUpload : null,
      updateMany: async ({ where, data }) => {
        if (where.messageId === draftId) {
          assert.ok(oldAttachment);
          assert.deepEqual(where.path, { not: attachment.path });
          assert.deepEqual(data, { messageId: null });
          releasedOldAttachment = true;
          return { count: 1 };
        }
        assert.equal(currentUpload.clientRequestId, null);
        currentUpload = { ...currentUpload, ...data };
        return { count: 1 };
      },
      update: async ({ data }) => {
        if (oldAttachment) assert.ok(releasedOldAttachment);
        return currentUpload = { ...currentUpload, ...data };
      },
    };
    db.conversation.update = async () => ({});
    db.activity = { create: async () => ({}) };
    db.auditLog = { create: async () => ({}) };
    const email = t.mock.fn(async payload => {
      assert.equal(payload.text, caption);
      assert.equal(payload.attachment.path, path);
      return { messageId: "synthetic-email" };
    });
    const gmail = new CommunicationsService(db, { send: email });
    const chatwoot = lostResponse ? fetch : t.mock.method(service, "sendChatwootProviderMessage", async (_settings, _recipient, text, file) => {
      assert.equal(text, caption);
      assert.equal(file.path, path);
      return { id: 99, content: "Provider-normalized caption" };
    });
    const whatsapp = t.mock.method(service, "whatsappGraph", async (_url, _token, payload) => {
      assert.equal(payload.document.caption, caption);
      assert.equal(payload.document.filename, attachment.name);
      return { messages: [{ id: "wamid.synthetic" }] };
    });
    const sender = channel === "EMAIL" ? gmail : service;
    const providerSend = channel === "EMAIL" ? email : channel === "CHATWOOT" ? chatwoot : whatsapp;
    const request = usesDraft ? { ...input, draftMessageId: draftId, content: "Stale composer text" } : { ...input, content: caption };
    if (lostResponse) {
      db.appSetting = { upsert: async () => ({}) };
      await assert.rejects(sender.send("buyer", request, actor), { status: 409 });
      assert.equal(currentAttempt.status, "UNCERTAIN");
      assert.equal(currentUpload.clientRequestId, requestId);
      assert.equal(row.status, "DRAFT");
      await assert.rejects(sender.send("buyer", request, actor), { status: 409 });
      assert.equal(providerSend.mock.callCount(), 1);
      const held = currentAttempt;
      if (usesDraft) {
        db.messageDeliveryAttempt.findUnique = async ({ where }) => where.clientRequestId === requestId ? held : null;
        db.messageDeliveryAttempt.findFirst = async () => held;
        db.messageDeliveryAttempt.findMany = async () => [held];
        const retryId = "eae7c36b-4cb8-4696-aa9e-87c23768d7bf";
        await assert.rejects(sender.send("buyer", { ...request, attachment: undefined, clientRequestId: retryId }, actor), { status: 409 });
        assert.equal(providerSend.mock.callCount(), 1);
      } else {
        const independentId = "eae7c36b-4cb8-4696-aa9e-87c23768d7bf";
        db.messageDeliveryAttempt.findUnique = async ({ where }) => where.clientRequestId === requestId ? held : null;
        db.messageDeliveryAttempt.findFirst = async () => held;
        db.messageDeliveryAttempt.findMany = async () => [held];
        db.communicationAttachment.groupBy = async ({ where, by }) => {
          assert.deepEqual(where, { clientRequestId: { in: [requestId] }, messageId: null });
          assert.deepEqual(by, ["clientRequestId"]);
          return [{ clientRequestId: requestId, _count: { _all: 1 } }];
        };
        db.message.upsert = async ({ create }) => ({ ...create, id: "independent-sent" });
        const independentSend = t.mock.method(service, "sendChatwootProviderMessage", async (_settings, _id, text, file) => {
          assert.equal(text, "Independent reply");
          assert.equal(file, undefined);
          return { id: 123, content: text };
        });
        const independent = await sender.send("buyer", {
          action: "SEND", channel, clientRequestId: independentId, content: "Independent reply",
        }, actor);
        assert.equal(independent.status, "SENT");
        assert.equal(held.status, "UNCERTAIN");
        assert.equal(currentUpload.clientRequestId, requestId);
        assert.equal(independentSend.mock.callCount(), 1);
        assert.equal(providerSend.mock.callCount(), 1);
      }
      return;
    }
    const sent = await sender.send("buyer", request, actor);
    assert.equal(sent.id, draftId);
    assert.equal(sent.status, "SENT");
    assert.equal(sent.metadata.attachments[0].name, attachment.name);
    assert.equal(currentUpload.messageId, draftId);
    assert.deepEqual(await sender.send("buyer", request, actor), sent);
    await assert.rejects(sender.send("buyer", { ...request, content: "Different request" }, actor), { status: 409 });
    await assert.rejects(sender.send("buyer", { ...request, attachment: { ...attachment, name: "replacement.pdf" } }, actor), { status: 409 });
    await assert.rejects(sender.send("buyer", request, { id: "other-staff" }), { status: 409 });
    await assert.rejects(sender.send("buyer", { ...request, attachment: undefined }, { id: "other-staff" }), { status: 409 });
    await assert.rejects(sender.send("buyer", { ...request, attachment: undefined, draftMessageId: undefined }, { id: "other-staff" }), { status: 409 });
    if (channel === "WHATSAPP") {
      const originalUpload = currentUpload;
      const replacementPath = path.replaceAll("1", "3");
      const replacement = { ...attachment, path: replacementPath };
      const available = { ...currentUpload, ...replacement, messageId: null, clientRequestId: null, claimedAt: null, createdById: "other-staff" };
      const oldLookup = db.communicationAttachment.findUnique;
      db.communicationAttachment.findUnique = async args => args.where.path === replacementPath ? available : oldLookup(args);
      await writeFile(join(process.env.UPLOADS_DIR, "communication-files", replacementPath), pdf);
      try {
        await assert.rejects(sender.send("buyer", { ...request, draftMessageId: undefined, attachment: replacement }, { id: "other-staff" }), { status: 409 });
      } finally {
        await unlink(join(process.env.UPLOADS_DIR, "communication-files", replacementPath));
      }
      assert.equal(currentUpload, originalUpload);
    }
    assert.equal(providerSend.mock.callCount(), 1);
  });
}

for (const channel of ["FACEBOOK", "INSTAGRAM"]) {
  test(`${channel} rejects combined saved draft sends before a provider can drop the text`, async t => {
    const { service, db, input, provider } = fixture(t, channel, { savedAttempt: null });
    db.message.findFirst = async () => ({ id: "saved-draft-with-attachment", content: "Saved text", metadata: null });
    await assert.rejects(service.send("buyer", { ...input, draftMessageId: "saved-draft-with-attachment" }, actor), { status: 400 });
    assert.equal(provider.mock.callCount(), 0);
  });
}


test("editing a legacy attachment draft preserves the same scoped draft and original file", async () => {
  const draftId = "saved-draft-with-attachment";
  let draft = { id: draftId, metadata: { attachments: [attachment] }, content: "Draft content" };
  const db = {
    $executeRaw: async () => {},
    $transaction: async fn => fn(db),
    conversation: { upsert: async () => ({ id: "scoped-email", channel: "EMAIL" }) },
    message: {
      findMany: async () => [],
      findFirst: async ({ where }) => {
        assert.deepEqual(where, {
          id: draftId, conversationId: "scoped-email", status: "DRAFT", direction: "OUTBOUND",
        });
        return draft;
      },
      update: async ({ data }) => draft = { ...draft, ...data },
      create: async () => assert.fail("editing must not create a newer text-only draft"),
    },
    auditLog: { create: async () => ({}) },
  };
  const service = new CommunicationsService(db);
  const edit = { channel: "EMAIL", content: "Updated legacy draft", legacyDraftId: draftId };
  const updated = await service.updateDraft("buyer", requestId, edit, actor);
  assert.equal(updated.id, draftId);
  assert.equal(updated.content, edit.content);
  assert.deepEqual(updated.metadata, { composerDraftKey: requestId, attachments: [attachment] });
  await assert.rejects(service.updateDraft("buyer", "eae7c36b-4cb8-4696-aa9e-87c23768d7bf", edit, actor), { status: 409 });
});

for (const [channel, ambiguous] of [["EMAIL",false], ["CHATWOOT",false], ["CHATWOOT",true]]) {
  test(`${channel} ${ambiguous ? "holds a bundle after provider acceptance and permits an independent text reply" : "reserves and sends two photos as one message and safely replays the whole bundle"}`, async t => {
    await installTestUpload(t);
    const directory = join(process.env.UPLOADS_DIR, "communication-files");
    const photoPaths = [
      "11111111-1111-4111-8111-111111111111.png",
      "22222222-2222-4222-8222-222222222222.png",
    ];
    const photos = photoPaths.map((path, index) => ({ path, name: index ? "back.png" : "front.png", mimeType: "image/png" }));
    for (const photo of photos) await writeFile(join(directory, photo.path), pdf);
    const { service, db, input } = fixture(t, channel, { savedAttempt: null });
    const draftId = "saved-draft-two-photos";
    const caption = "Front and back";
    let draft = { id: draftId, conversationId: "chat", direction: "OUTBOUND", status: "DRAFT", content: caption };
    let current;
    const uploads = new Map(photos.map(photo => [photo.path, {
      ...photo, originalName: photo.name, createdById: actor.id, sizeBytes: pdf.length,
      messageId: null, clientRequestId: null, claimedAt: null,
    }]));
    db.communicationAttachment = {
      findUnique: async ({ where }) => uploads.get(where.path),
      updateMany: async ({ where, data }) => {
        assert.deepEqual(where.path, { in: photos.map(file => file.path) });
        assert.ok([...uploads.values()].every(file => file.clientRequestId === null));
        for (const file of uploads.values()) Object.assign(file, data);
        return { count: photos.length };
      },
      update: async ({ where, data }) => Object.assign(uploads.get(where.path), data),
    };
    db.messageDeliveryAttempt = {
      findUnique: async () => current,
      findFirst: async () => null,
      create: async ({ data }) => current = data,
      update: async ({ data }) => Object.assign(current, data),
    };
    db.message = {
      findFirst: async ({ where }) => where.id === draftId && draft.status === where.status ? draft : null,
      findUnique: async ({ where }) => where.id === draftId ? draft : null,
      update: async ({ data }) => draft = { ...draft, ...data },
    };
    db.conversation.update = async () => ({});
    db.activity = { create: async () => ({}) };
    db.auditLog = { create: async () => ({}) };
    const deliver = t.mock.fn(async (text, files) => {
      assert.equal(text, caption);
      assert.deepEqual(files.map(file => file.path), photoPaths);
      assert.ok([...uploads.values()].every(upload => upload.clientRequestId === requestId));
      return { messageId: "provider-mail", id: 42, content: caption };
    });
    const gmail = new CommunicationsService(db, { send: body => deliver(body.text, body.attachments) });
    service.sendChatwootProviderMessage = (_settings, _conversation, content, attachments) => deliver(content, attachments);
    const sender = channel === "EMAIL" ? gmail : service;
    const request = { ...input, attachment: undefined, attachments: photos, content: caption, draftMessageId: ambiguous ? undefined : draftId };
    try {
      if (ambiguous) {
        db.appSetting = { upsert: async () => ({}) };
        db.message.upsert = async () => { throw new Error("Commit failed after provider acceptance"); };
        await assert.rejects(sender.send("buyer", request, actor), { status: 409 });
        assert.equal(current.status, "UNCERTAIN");
        assert.ok([...uploads.values()].every(upload => upload.clientRequestId === requestId));
        await assert.rejects(sender.send("buyer", request, actor), { status: 409 });
        assert.equal(deliver.mock.callCount(), 1);
        const held = current;
        db.messageDeliveryAttempt.findUnique = async ({ where }) => where.clientRequestId === requestId ? held : null;
        db.messageDeliveryAttempt.findFirst = async () => held;
        db.messageDeliveryAttempt.findMany = async () => [held];
        db.communicationAttachment.groupBy = async () => [{ clientRequestId: requestId, _count: { _all: 2 } }];
        const freshPaths = ["33333333-3333-4333-8333-333333333333.png", "44444444-4444-4444-8444-444444444444.png"];
        const fresh = photos.map((photo, index) => ({ ...photo, path: freshPaths[index] }));
        for (const photo of fresh) {
          await writeFile(join(directory, photo.path), pdf);
          uploads.set(photo.path, { ...uploads.get(photoPaths[0]), ...photo, originalName: photo.name, clientRequestId: null });
        }
        try {
          await assert.rejects(sender.send("buyer", {
            ...request, attachments: fresh, clientRequestId: "3c907117-7ea5-4798-8da5-80c3257af963",
          }, actor), { status: 409 });
          assert.equal(deliver.mock.callCount(), 1);
        } finally {
          for (const path of freshPaths) await unlink(join(directory, path));
        }
        db.message.upsert = async ({ create }) => ({ ...create, id: "independent-sent" });
        const independent = t.mock.method(service, "sendChatwootProviderMessage", async (_settings, _id, text, files) => {
          assert.equal(text, "Independent reply");
          assert.equal(files, undefined);
          return { id: 99, content: text };
        });
        await sender.send("buyer", {
          action: "SEND", channel, content: "Independent reply", clientRequestId: "3c907117-7ea5-4798-8da5-80c3257af963",
        }, actor);
        assert.equal(held.status, "UNCERTAIN");
        assert.equal(independent.mock.callCount(), 1);
        return;
      }
      const sent = await sender.send("buyer", request, actor);
      assert.equal(sent.status, "SENT");
      assert.deepEqual(sent.metadata.attachments.map(file => file.name), photos.map(file => file.name));
      assert.ok(sent.metadata.attachments.every(file => !file.providerUrl));
      assert.ok([...uploads.values()].every(file => file.messageId === draftId && file.clientRequestId === null));
      assert.deepEqual(await sender.send("buyer", request, actor), sent);
      await assert.rejects(sender.send("buyer", { ...request, attachments: [...photos].reverse() }, actor), { status: 409 });
      await assert.rejects(sender.send("buyer", { ...request, attachments: undefined, attachment: photos[0] }, actor), { status: 409 });
      await assert.rejects(sender.send("buyer", request, { id: "other-staff" }), { status: 409 });
      assert.equal(deliver.mock.callCount(), 1);
    } finally {
      for (const path of photoPaths) await unlink(join(directory, path));
    }
  });
}

test("the message bundle body accepts photos without a caption and still rejects empty messages", async () => {
  const { SendMessageDto } = loadTargetModule("communications/communications.dto.ts");
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const metadata = { type: "body", metatype: SendMessageDto };
  const attachments = [attachment, { ...attachment, path: "22222222-2222-4222-8222-222222222222.pdf" }];
  for (const channel of ["EMAIL", "CHATWOOT"]) {
    const dto = await pipe.transform({ channel, action: "SEND", attachments }, metadata);
    assert.deepEqual(dto.attachments.map(item => ({ ...item })), attachments);
    assert.equal(dto.content, undefined);
  }
  await assert.rejects(pipe.transform({ action: "SEND" }, metadata));
});
