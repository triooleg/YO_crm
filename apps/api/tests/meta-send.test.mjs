import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/communications/meta-send.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(javascript, { module, exports: module.exports });
const { metaRecipientId, metaTextMessageParams, metaAttachmentMessageParams, metaThreadControlParams, metaSendFailure, runMetaSendOnce, deliverMetaWithThreadControl } = module.exports;

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

test("Meta send builds a reusable Messenger attachment payload", () => {
  const params = metaAttachmentMessageParams("psid-7", "image", "https://crm.yoleotard.com/api/communications/files/example.jpg");
  assert.deepEqual(JSON.parse(JSON.stringify(params)), {
    recipient: JSON.stringify({ id: "psid-7" }),
    messaging_type: "RESPONSE",
    message: JSON.stringify({ attachment: { type: "image", payload: { url: "https://crm.yoleotard.com/api/communications/files/example.jpg", is_reusable: true } } }),
  });
  assert.equal(JSON.stringify(params).includes("token"), false);
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
