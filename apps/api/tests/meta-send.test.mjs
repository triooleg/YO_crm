import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/communications/meta-send.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(javascript, { module, exports: module.exports });
const { metaRecipientId, metaTextMessageParams, metaSendFailure, runMetaSendOnce } = module.exports;

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
