import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../lib/inbox-message-visibility.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(javascript, { module, exports: module.exports });
const { inboxDraftNeedsSave, prepareInboxMessages, restoreInboxDraft } = module.exports;

test("отправленный черновик занимает место по фактическому времени отправки",()=>{
  const prepared=prepareInboxMessages([
    {id:"reply",status:"SENT",direction:"OUTBOUND",channel:"CHATWOOT",createdAt:"2026-10-14T12:00:00Z",sentAt:"2026-10-14T12:58:00Z",content:"Ответ"},
    {id:"incoming",status:"RECEIVED",direction:"INBOUND",channel:"CHATWOOT",createdAt:"2026-10-14T12:47:00Z",content:"Вопрос"},
  ],"CHATWOOT");
  assert.deepEqual(prepared.visible.map(message=>message.id),["incoming","reply"]);
});

test("does not expose drafts as chat messages and restores the newest channel draft", () => {
  const messages = [
    { id: "sent", status: "SENT", channel: "INSTAGRAM", createdAt: "2026-09-14T10:00:00Z", content: "Отправлено" },
    { id: "old", status: "DRAFT", channel: "INSTAGRAM", createdAt: "2026-09-14T10:01:00Z", content: "Старый", metadata: { composerDraftKey: "old-key" } },
    { id: "new", status: "DRAFT", channel: "INSTAGRAM", createdAt: "2026-09-14T10:02:00Z", content: "Новый", metadata: { composerDraftKey: "new-key", aiRunId: "ai-run-1" } },
    { id: "fb", status: "DRAFT", channel: "FACEBOOK", createdAt: "2026-09-14T10:03:00Z", content: "Facebook" },
  ];
  const prepared = prepareInboxMessages(messages, "INSTAGRAM");
  assert.deepEqual(prepared.visible.map(message => message.id), ["sent"]);
  assert.equal(prepared.draft?.id, "new");
  assert.equal(prepared.draftKey, "new-key");
  assert.equal(prepared.draftAiRunId, "ai-run-1");
});

test("keeps volatile composer text when a channel changes before autosave", () => {
  const messages = [
    { id: "saved", status: "DRAFT", channel: "FACEBOOK", createdAt: "2026-09-14T10:00:00Z", content: "Сохранённый" },
  ];
  assert.equal(restoreInboxDraft(messages, "FACEBOOK", "Новый текст").content, "Новый текст");
  assert.equal(restoreInboxDraft(messages, "FACEBOOK").content, "Сохранённый");
  assert.equal(restoreInboxDraft(messages, "INSTAGRAM").content, "");
});

test("autosaves AI provenance changes even when the visible text stays the same", () => {
  assert.equal(inboxDraftNeedsSave("Одинаковый текст", undefined, "Одинаковый текст", "ai-run-1"), true);
  assert.equal(inboxDraftNeedsSave("Одинаковый текст", "ai-run-1", "Одинаковый текст", undefined), true);
  assert.equal(inboxDraftNeedsSave("Одинаковый текст", "ai-run-1", "  Одинаковый текст  ", "ai-run-1"), false);
  assert.equal(inboxDraftNeedsSave("", undefined, "   ", undefined), false);
});
