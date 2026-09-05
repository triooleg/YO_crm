import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/communications/meta-send.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(javascript, { module, exports: module.exports });
const { MetaDeliveryUncertainError, instagramReactionMessageParams, whatsappReactionMessageParams, metaCommentReplyParams, metaRecipientId, metaRecipientIdForReceivers, metaTextMessageParams, metaAttachmentMessageParams, whatsappTextMessageParams, whatsappAttachmentMessageParams, whatsappAttachmentHistoryContent, whatsappImageMimeAllowed, whatsappVideoMimeAllowed, whatsappMessageId, metaThreadControlParams, metaSendFailure, releaseUncertainWhatsappAttempt, runMetaSendOnce, deliverMetaWithThreadControl, deliverMetaMessage } = module.exports;

test("Meta send accepts only the exact configured Page scope", () => {
  assert.equal(metaRecipientId("page-1", "page-1:psid-7"), "psid-7");
  assert.equal(metaRecipientId("page-1", "page-2:psid-7"), "");
  assert.equal(metaRecipientId("page-1", "psid-7"), "");
});

test("Meta send builds a RESPONSE text payload without credentials", () => {
  const params = metaTextMessageParams("psid-7", "Здравствуйте");
  assert.deepEqual(JSON.parse(JSON.stringify(params)), {
    recipient: JSON.stringify({ id: "psid-7" }),
    messaging_type: "RESPONSE",
    message: JSON.stringify({ text: "Здравствуйте" }),
  });
  assert.equal(JSON.stringify(params).includes("token"), false);
});

test("Meta public comment reply uses the provider comment edge", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(metaCommentReplyParams("FACEBOOK", "comment-1", "Спасибо!"))), {
    path:"comment-1/comments",
    params:{message:"Спасибо!"},
  });
  assert.equal(metaCommentReplyParams("INSTAGRAM", "comment-1", "Спасибо!").path,"comment-1/replies");
  assert.throws(()=>metaCommentReplyParams("FACEBOOK","../messages","unsafe"),/comment id/i);
});

test("Instagram reaction removal omits the reaction value rejected by Meta", () => {
  const react = instagramReactionMessageParams("igsid-7", "ig-mid-1", "react");
  const unreact = instagramReactionMessageParams("igsid-7", "ig-mid-1", "unreact");
  assert.deepEqual(JSON.parse(react.payload), { message_id: "ig-mid-1", reaction: "love" });
  assert.deepEqual(JSON.parse(unreact.payload), { message_id: "ig-mid-1" });
  assert.equal(react.sender_action, "react");
  assert.equal(unreact.sender_action, "unreact");
});

test("WhatsApp reaction payload attaches an emoji to a message and removes it with an empty emoji", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappReactionMessageParams("380633582077", "wamid.in-1", "react", "👍"))), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "380633582077",
    type: "reaction",
    reaction: { message_id: "wamid.in-1", emoji: "👍" },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappReactionMessageParams("380633582077", "wamid.in-1", "unreact", "👍"))).reaction, {
    message_id: "wamid.in-1",
    emoji: "",
  });
  assert.throws(() => whatsappReactionMessageParams("380633582077", "wamid.in-1", "react", "🔥"), /reaction emoji/i);
});

test("WhatsApp and Instagram reply payloads preserve the referenced provider message", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappTextMessageParams("380633582077", "Ответ", "wamid.in-1"))).context, { message_id:"wamid.in-1" });
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappAttachmentMessageParams("380633582077", "image", "https://crm.yoleotard.com/image.jpg", "image.jpg", "Фото", "wamid.in-1"))).context, { message_id:"wamid.in-1" });
  assert.deepEqual(JSON.parse(metaTextMessageParams("igsid-7", "Ответ", "ig-mid-1").message).reply_to, { mid:"ig-mid-1" });
});

test("Meta send builds a reusable Messenger attachment payload", () => {
  const params = metaAttachmentMessageParams("psid-7", "image", "https://crm.yoleotard.com/api/communications/files/example.jpg");
  assert.deepEqual(JSON.parse(JSON.stringify(params)), {
    recipient: JSON.stringify({ id: "psid-7" }),
    messaging_type: "RESPONSE",
    message: JSON.stringify({ attachment: { type: "image", payload: { url: "https://crm.yoleotard.com/api/communications/files/example.jpg", is_reusable: true } } }),
  });
  assert.equal(JSON.stringify(params).includes("token"), false);
  assert.equal(JSON.parse(metaAttachmentMessageParams("psid-7", "video", "https://crm.yoleotard.com/clip.mp4").message).attachment.type, "video");
});

test("WhatsApp send builds Cloud API text and attachment payloads without credentials", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappTextMessageParams("380633582077", "Здравствуйте"))), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "380633582077",
    type: "text",
    text: { preview_url: true, body: "Здравствуйте" },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappAttachmentMessageParams("380633582077", "image", "https://crm.yoleotard.com/media.jpg", "model.jpg"))), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "380633582077",
    type: "image",
    image: { link: "https://crm.yoleotard.com/media.jpg" },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappAttachmentMessageParams("380633582077", "image", "https://crm.yoleotard.com/media.jpg", "model.jpg", "Подпись менеджера"))), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "380633582077",
    type: "image",
    image: { link: "https://crm.yoleotard.com/media.jpg", caption: "Подпись менеджера" },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappAttachmentMessageParams("380633582077", "file", "https://crm.yoleotard.com/model.pdf", "model.pdf"))), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "380633582077",
    type: "document",
    document: { link: "https://crm.yoleotard.com/model.pdf", filename: "model.pdf" },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappAttachmentMessageParams("380633582077", "file", "https://crm.yoleotard.com/model.pdf", "model.pdf", "Документ к заказу"))), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "380633582077",
    type: "document",
    document: { link: "https://crm.yoleotard.com/model.pdf", filename: "model.pdf", caption: "Документ к заказу" },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(whatsappAttachmentMessageParams("380633582077", "video", "https://crm.yoleotard.com/clip.mp4", "clip.mp4", "Короткое видео"))), {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: "380633582077",
    type: "video",
    video: { link: "https://crm.yoleotard.com/clip.mp4", caption: "Короткое видео" },
  });
  const unicodeCaption = "😀".repeat(1024);
  assert.equal(whatsappAttachmentMessageParams("380633582077", "image", "https://crm.yoleotard.com/media.jpg", "model.jpg", unicodeCaption).image.caption, unicodeCaption);
  assert.throws(() => whatsappAttachmentMessageParams("380633582077", "image", "https://crm.yoleotard.com/media.jpg", "model.jpg", "😀".repeat(1025)), /1024/);
  assert.equal(whatsappImageMimeAllowed("image/jpeg"), true);
  assert.equal(whatsappImageMimeAllowed("image/png"), true);
  assert.equal(whatsappImageMimeAllowed("image/webp"), false);
  assert.equal(whatsappImageMimeAllowed("image/gif"), false);
  assert.equal(whatsappVideoMimeAllowed("video/mp4"), true);
  assert.equal(whatsappVideoMimeAllowed("video/quicktime"), false);
  assert.equal(whatsappAttachmentHistoryContent("image", "model.jpg", ""), "[Фото]");
  assert.equal(whatsappAttachmentHistoryContent("image", "model.jpg", " Подпись "), "Подпись");
  assert.equal(whatsappAttachmentHistoryContent("file", "model.pdf", ""), "model.pdf");
  assert.equal(whatsappAttachmentHistoryContent("file", "model.pdf", " Документ "), "Документ");
  assert.equal(whatsappAttachmentHistoryContent("video", "clip.mp4", ""), "[Видео]");
  assert.equal(whatsappMessageId({ messages: [{ id: "wamid-1" }] }), "wamid-1");
  assert.equal(whatsappMessageId({ messages: [] }), "");
});

test("Instagram send uses the configured account scope and never invokes Facebook thread control", async () => {
  assert.equal(metaRecipientId("ig-business-1", "ig-business-1:igsid-7"), "igsid-7");
  const calls = [];
  const result = await deliverMetaMessage("INSTAGRAM", {
    send: async () => (calls.push("send"), { message_id: "ig-mid-1" }),
    takeControl: async () => calls.push("take-control"),
    isThreadControlError: () => true,
    onTakeControlSuccess: async () => calls.push("audit-success"),
    onTakeControlFailure: async () => calls.push("audit-failure"),
  });
  assert.equal(result.message_id, "ig-mid-1");
  assert.deepEqual(calls, ["send"]);
});

test("WhatsApp send never invokes Facebook thread control", async () => {
  const calls = [];
  const result = await deliverMetaMessage("WHATSAPP", {
    send: async () => (calls.push("send"), { messages: [{ id: "wamid-1" }] }),
    takeControl: async () => calls.push("take-control"),
    isThreadControlError: () => true,
    onTakeControlSuccess: async () => calls.push("audit-success"),
    onTakeControlFailure: async () => calls.push("audit-failure"),
  });
  assert.equal(result.messages[0].id, "wamid-1");
  assert.deepEqual(calls, ["send"]);
});

test("Instagram send resolves a conversation saved under the verified webhook receiver namespace", () => {
  assert.equal(metaRecipientIdForReceivers(
    ["28156785147355107", "17841407931852361"],
    "17841407931852361:2164323137740727",
  ), "2164323137740727");
  assert.equal(metaRecipientIdForReceivers(
    ["28156785147355107", "17841407931852361"],
    "999999:2164323137740727",
  ), "");
});

test("Meta send converts provider errors into safe actionable reasons", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(metaSendFailure({ code: 190, error_subcode: 463 }))), {
    code: 190,
    subcode: 463,
    reason: "TOKEN_EXPIRED",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(metaSendFailure({ code: 10 }))), {
    code: 10,
    reason: "PERMISSION_REQUIRED",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(metaSendFailure({ code: 551 }))), {
    code: 551,
    reason: "RECIPIENT_UNAVAILABLE",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(metaSendFailure({ code: 200, error_subcode: 2018278 }))), {
    code: 200,
    subcode: 2018278,
    reason: "REPLY_WINDOW_CLOSED",
  });
  assert.equal(metaSendFailure({ code: 10, error_subcode: 2018278 }).reason, "REPLY_WINDOW_CLOSED");
  assert.deepEqual(JSON.parse(JSON.stringify(metaSendFailure({ code: 10, error_subcode: 2018300 }))), {
    code: 10,
    subcode: 2018300,
    reason: "THREAD_CONTROL_REQUIRED",
  });
  assert.equal(metaSendFailure({ code: 10, error_subcode: 2018171 }).reason, "THREAD_CONTROL_REQUIRED");
  assert.deepEqual(JSON.parse(JSON.stringify(metaSendFailure({ code: 27, error_subcode: 1893034 }))), {
    code: 27,
    subcode: 1893034,
    reason: "THREAD_CONTROL_REQUIRED",
  });
  assert.equal(metaSendFailure({ code: 27, error_subcode: 9999999 }).reason, "PROVIDER_REJECTED");
  assert.equal(metaSendFailure({ code: 10, error_subcode: 1893034 }).reason, "PERMISSION_REQUIRED");
});

test("Meta send takes thread control once and retries the message once", async () => {
  const params = metaThreadControlParams("psid-7");
  assert.deepEqual(JSON.parse(JSON.stringify(params)), { recipient: JSON.stringify({ id: "psid-7" }) });
  const calls = [], audits = [];
  const result = await deliverMetaWithThreadControl({
    send: async () => {
      calls.push("send");
      if (calls.length === 1) {
        const error = new Error("handover");
        error.failure = { code: 10, subcode: 2018300, reason: "THREAD_CONTROL_REQUIRED" };
        throw error;
      }
      return { message_id: "mid-after-control" };
    },
    takeControl: async () => { calls.push("take-control"); },
    isThreadControlError: error => error?.failure?.reason === "THREAD_CONTROL_REQUIRED",
    onTakeControlSuccess: async () => { audits.push("THREAD_CONTROL_TAKEN"); },
    onTakeControlFailure: async () => { audits.push("THREAD_CONTROL_FAILED"); },
  });
  assert.deepEqual(calls, ["send", "take-control", "send"]);
  assert.deepEqual(audits, ["THREAD_CONTROL_TAKEN"]);
  assert.equal(result.message_id, "mid-after-control");
});

test("successful thread control is audited even when the retry fails", async () => {
  let sends = 0;
  const audits = [];
  await assert.rejects(deliverMetaWithThreadControl({
    send: async () => {
      sends += 1;
      const error = new Error(sends === 1 ? "handover" : "retry failed");
      if (sends === 1) error.failure = { reason: "THREAD_CONTROL_REQUIRED" };
      throw error;
    },
    takeControl: async () => undefined,
    isThreadControlError: error => error?.failure?.reason === "THREAD_CONTROL_REQUIRED",
    onTakeControlSuccess: async () => { audits.push("THREAD_CONTROL_TAKEN"); },
    onTakeControlFailure: async () => { audits.push("THREAD_CONTROL_FAILED"); },
  }), /retry failed/);
  assert.equal(sends, 2);
  assert.deepEqual(audits, ["THREAD_CONTROL_TAKEN"]);
});

test("failed thread control is audited and never triggers a second send", async () => {
  let sends = 0;
  const audits = [];
  await assert.rejects(deliverMetaWithThreadControl({
    send: async () => {
      sends += 1;
      const error = new Error("handover");
      error.failure = { reason: "THREAD_CONTROL_REQUIRED" };
      throw error;
    },
    takeControl: async () => { throw new Error("take failed"); },
    isThreadControlError: error => error?.failure?.reason === "THREAD_CONTROL_REQUIRED",
    onTakeControlSuccess: async () => { audits.push("THREAD_CONTROL_TAKEN"); },
    onTakeControlFailure: async () => { audits.push("THREAD_CONTROL_FAILED"); },
  }), /take failed/);
  assert.equal(sends, 1);
  assert.deepEqual(audits, ["THREAD_CONTROL_FAILED"]);
});

test("Meta send never retries unrelated failures", async () => {
  let sends = 0, takeControl = 0;
  await assert.rejects(deliverMetaWithThreadControl({
    send: async () => { sends += 1; throw new Error("other"); },
    takeControl: async () => { takeControl += 1; },
    isThreadControlError: () => false,
    onTakeControlSuccess: async () => undefined,
    onTakeControlFailure: async () => undefined,
  }), /other/);
  assert.equal(sends, 1);
  assert.equal(takeControl, 0);
});

test("concurrent and repeated delivery uses the provider exactly once", async () => {
  let state = "EMPTY", saved, providerCalls = 0, release;
  const gate = new Promise((resolve) => { release = resolve; });
  const operation = () => runMetaSendOnce({
    reserve: async () => state === "EMPTY"
      ? (state = "PENDING", { kind: "NEW" })
      : state === "PENDING" ? { kind: "PENDING" } : { kind: "DONE", result: saved },
    deliver: async () => { providerCalls += 1; await gate; return { message_id: "mid-1" }; },
    persistSuccess: async (provider) => { saved = { id: "message-1", externalId: provider.message_id }; state = "DONE"; return saved; },
    persistFailure: async () => { throw new Error("not expected"); },
    pendingError: () => new Error("PENDING"),
  });
  const first = operation();
  await assert.rejects(operation(), /PENDING/);
  release();
  assert.deepEqual(await first, { id: "message-1", externalId: "mid-1" });
  assert.deepEqual(await operation(), { id: "message-1", externalId: "mid-1" });
  assert.equal(providerCalls, 1);
});

test("an uncertain provider result reaches the durable blocking path instead of confirmed failure", async () => {
  let uncertain = false, confirmedFailure = false;
  await assert.rejects(() => runMetaSendOnce({
    reserve: async () => ({ kind: "NEW" }),
    deliver: async () => { throw new MetaDeliveryUncertainError(); },
    persistSuccess: async () => { throw new Error("not expected"); },
    persistFailure: async error => {
      uncertain = error instanceof MetaDeliveryUncertainError;
      if (!uncertain) confirmedFailure = true;
      throw new Error("retry blocked");
    },
    pendingError: () => new Error("pending"),
  }), /retry blocked/);
  assert.equal(uncertain, true);
  assert.equal(confirmedFailure, false);
});

test("network uncertainty persists the AI reservation so manual release makes it reusable", async () => {
  let status = "EMPTY", aiAccepted = null;
  const records = new Map();
  await assert.rejects(() => runMetaSendOnce({
    reserve: async () => {
      status = "PENDING";
      aiAccepted = false;
      return { kind: "NEW" };
    },
    deliver: async () => { throw new MetaDeliveryUncertainError(); },
    persistSuccess: async () => { throw new Error("not expected"); },
    persistFailure: async error => {
      assert.equal(error instanceof MetaDeliveryUncertainError, true);
      status = "UNCERTAIN";
      records.set("attempt-1", { aiRunId: "ai-run-1", actorId: "owner-1" });
      throw new Error("UNCERTAIN");
    },
    pendingError: () => new Error("PENDING"),
  }), /UNCERTAIN/);

  const result = await releaseUncertainWhatsappAttempt({
    claim: async () => {
      if (status !== "UNCERTAIN") return false;
      status = "FAILED";
      return true;
    },
    releaseAttachment: async () => {},
    recordResolution: async () => {
      if (records.get("attempt-1")?.aiRunId === "ai-run-1" && aiAccepted === false) aiAccepted = null;
      records.delete("attempt-1");
      return { released: true };
    },
    changedError: () => new Error("CHANGED"),
  });

  assert.deepEqual(result, { released: true });
  assert.equal(status, "FAILED");
  assert.equal(aiAccepted, null);
  assert.equal(records.size, 0);
});

test("an uncertain WhatsApp attempt blocks a different request id before a second provider call", async () => {
  const attempts = new Map();
  let providerCalls = 0;
  const operation = requestId => runMetaSendOnce({
    reserve: async () => {
      const existing = attempts.get(requestId);
      if (existing === "PENDING" || existing === "UNCERTAIN") return { kind: "PENDING" };
      if ([...attempts.values()].some(status => status === "PENDING" || status === "UNCERTAIN")) return { kind: "PENDING" };
      attempts.set(requestId, "PENDING");
      return { kind: "NEW" };
    },
    deliver: async () => {
      providerCalls += 1;
      throw new MetaDeliveryUncertainError();
    },
    persistSuccess: async () => { throw new Error("not expected"); },
    persistFailure: async error => {
      assert.equal(error instanceof MetaDeliveryUncertainError, true);
      attempts.set(requestId, "UNCERTAIN");
      throw new Error("UNCERTAIN");
    },
    pendingError: () => new Error("PENDING_OR_UNCERTAIN"),
  });

  await assert.rejects(operation("request-1"), /UNCERTAIN/);
  await assert.rejects(operation("request-2"), /PENDING_OR_UNCERTAIN/);
  assert.equal(providerCalls, 1);
});

test("manual WhatsApp uncertainty release is single-winner and releases attachment and AI reservation once", async () => {
  let status = "UNCERTAIN", attachmentClaim = "request-1", aiAccepted = false, attachmentReleases = 0, auditRecords = 0;
  const release = () => releaseUncertainWhatsappAttempt({
    claim: async () => {
      if (status !== "UNCERTAIN") return false;
      status = "FAILED";
      return true;
    },
    releaseAttachment: async () => {
      attachmentClaim = null;
      attachmentReleases += 1;
    },
    recordResolution: async () => {
      aiAccepted = null;
      auditRecords += 1;
      return { released: true };
    },
    changedError: () => new Error("CHANGED"),
  });

  const results = await Promise.allSettled([release(), release()]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(results.filter(result => result.status === "rejected" && /CHANGED/.test(result.reason.message)).length, 1);
  assert.equal(status, "FAILED");
  assert.equal(attachmentClaim, null);
  assert.equal(attachmentReleases, 1);
  assert.equal(aiAccepted, null);
  assert.equal(auditRecords, 1);
  await assert.rejects(release(), /CHANGED/);
  assert.equal(attachmentReleases, 1);
  assert.equal(auditRecords, 1);
});

test("provider success followed by persistence failure blocks duplicates until an authorized release", async () => {
  const attempts = new Map();
  let providerCalls = 0, storedProviderId = "", failPersistence = true;
  const operation = requestId => runMetaSendOnce({
    reserve: async () => {
      if ([...attempts.values()].some(status => status === "PENDING" || status === "UNCERTAIN")) return { kind: "PENDING" };
      attempts.set(requestId, "PENDING");
      return { kind: "NEW" };
    },
    deliver: async () => ({ message_id: `wamid-${++providerCalls}` }),
    persistSuccess: async provider => {
      if (failPersistence) throw new Error("database unavailable");
      attempts.set(requestId, "SENT");
      return { externalId: provider.message_id };
    },
    persistSuccessFailure: async (provider, error) => {
      assert.match(error.message, /database unavailable/);
      storedProviderId = provider.message_id;
      attempts.set(requestId, "UNCERTAIN");
      throw new Error("UNCERTAIN");
    },
    persistFailure: async () => { throw new Error("provider did not fail"); },
    pendingError: () => new Error("PENDING_OR_UNCERTAIN"),
  });

  await assert.rejects(operation("request-1"), /UNCERTAIN/);
  assert.equal(storedProviderId, "wamid-1");
  await assert.rejects(operation("request-2"), /PENDING_OR_UNCERTAIN/);
  assert.equal(providerCalls, 1);

  await releaseUncertainWhatsappAttempt({
    claim: async () => attempts.get("request-1") === "UNCERTAIN" && (attempts.set("request-1", "FAILED"), true),
    releaseAttachment: async () => undefined,
    recordResolution: async () => ({ released: true }),
    changedError: () => new Error("CHANGED"),
  });
  failPersistence = false;
  assert.deepEqual(await operation("request-2"), { externalId: "wamid-2" });
  assert.equal(providerCalls, 2);
});

test("an echo-first persistence race reconciles the draft and prevents it from being sent again", async () => {
  let attemptStatus = "PENDING", draftStatus = "DRAFT", deduplicatedIntoMessageId = "", aiFeedbackMessageId = "", providerCalls = 0;
  const echoedMessage = { id: "echo-message-1", externalId: "wamid-1", authorId: null, metadata: { source: "META", providerSnapshot: { status: "echo" }, attachments: [{ type: "image", mediaId: "media-1" }] } };
  const result = await runMetaSendOnce({
    reserve: async () => attemptStatus === "PENDING" ? { kind: "NEW" } : { kind: "PENDING" },
    deliver: async () => ({ message_id: `wamid-${++providerCalls}` }),
    persistSuccess: async () => { throw new Error("echo won the database race"); },
    persistSuccessFailure: async provider => {
      assert.equal(provider.message_id, echoedMessage.externalId);
      echoedMessage.authorId = "owner-1";
      echoedMessage.metadata = { ...echoedMessage.metadata, source: "CRM", provider: "META", receiverId: "phone-1", recipientId: "client-1" };
      draftStatus = "SENT";
      deduplicatedIntoMessageId = echoedMessage.id;
      aiFeedbackMessageId = echoedMessage.id;
      attemptStatus = "SENT";
      return echoedMessage;
    },
    persistFailure: async () => { throw new Error("provider did not fail"); },
    pendingError: () => new Error("BLOCKED"),
  });

  assert.deepEqual(result, echoedMessage);
  assert.equal(providerCalls, 1);
  assert.equal(attemptStatus, "SENT");
  assert.equal(draftStatus, "SENT");
  assert.equal(deduplicatedIntoMessageId, echoedMessage.id);
  assert.equal(aiFeedbackMessageId, echoedMessage.id);
  assert.equal(draftStatus === "DRAFT", false);
  assert.equal(echoedMessage.authorId, "owner-1");
  assert.equal(echoedMessage.metadata.source, "CRM");
  assert.deepEqual(echoedMessage.metadata.providerSnapshot, { status: "echo" });
  assert.deepEqual(echoedMessage.metadata.attachments, [{ type: "image", mediaId: "media-1" }]);
});
