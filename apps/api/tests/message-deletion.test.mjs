import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [controller, dto, service, helperSource] = await Promise.all([
  read("../src/communications/communications.controller.ts"),
  read("../src/communications/communications.dto.ts"),
  read("../src/communications/communications.service.ts"),
  read("../src/communications/message-deletion.ts").catch(() => ""),
]);
const compact = value => value.replace(/\s+/g, "");

async function loadHelper() {
  const javascript = ts.transpileModule(helperSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
}

test("message deletion API validates CRM or CLIENT mode and is CRM-role protected", () => {
  assert.match(compact(dto), /classDeleteMessageDto\{@IsIn\(\["CRM","CLIENT"\]asconst\)mode!:"CRM"\|"CLIENT"/);
  assert.match(compact(controller), /@Post\("messages\/:messageId\/delete"\)@Roles\("OWNER","ADMIN","MANAGER"\)deleteMessage\(@Param\("messageId"\)messageId:string,@Body\(\)d:DeleteMessageDto,@Req\(\)r:Request&\{user:User\}\)\{returnthis\.c\.deleteMessage\(messageId,d,r\.user\)\}/);
});

test("soft deletion metadata is monotonic and visible-message checks hide only completed deletion", async () => {
  const { isSoftDeletedMessage, softDeleteMetadata } = await loadHelper();
  const existing = { provider: "CHATWOOT", nested: { keep: true } };
  const deletedAt = new Date("2026-09-05T12:00:00.000Z");
  const metadata = softDeleteMetadata(existing, { mode: "CRM", actorId: "user-1", deletedAt });
  assert.deepEqual(metadata, {
    ...existing,
    deletion: { mode: "CRM", deletedAt: deletedAt.toISOString(), deletedById: "user-1", updatedAt: deletedAt.toISOString(), updatedById: "user-1" },
  });
  const providerDeletedAt = new Date("2026-09-05T12:05:00.000Z");
  const upgraded = softDeleteMetadata(metadata, { mode: "CLIENT", actorId: "user-2", deletedAt: providerDeletedAt, providerDeletedAt });
  assert.equal(upgraded.deletion.mode, "CLIENT");
  assert.equal(upgraded.deletion.deletedAt, deletedAt.toISOString());
  assert.equal(upgraded.deletion.deletedById, "user-1");
  assert.equal(upgraded.deletion.providerDeletedAt, providerDeletedAt.toISOString());
  const repeatedLocal = softDeleteMetadata(upgraded, { mode: "CRM", actorId: "user-3", deletedAt: new Date("2026-09-05T12:10:00.000Z") });
  assert.equal(repeatedLocal.deletion.mode, "CLIENT");
  assert.equal(repeatedLocal.deletion.providerDeletedAt, providerDeletedAt.toISOString());
  assert.equal(isSoftDeletedMessage(metadata), true);
  assert.equal(isSoftDeletedMessage({ ...existing, deletion: { mode: "CRM", requestedAt: deletedAt.toISOString() } }), false);
  assert.equal(isSoftDeletedMessage(existing), false);
});

test("Chatwoot delete target requires the scoped external id and documented endpoint", async () => {
  const { chatwootDeleteTarget } = await loadHelper();
  assert.deepEqual(chatwootDeleteTarget("chatwoot:17:991", "17"), { accountId: "17", messageId: "991" });
  assert.equal(chatwootDeleteTarget("chatwoot:18:991", "17"), undefined);
  assert.equal(chatwootDeleteTarget("991", "17"), undefined);
  const x = compact(service);
  assert.match(x, /api\/v1\/accounts\/\$\{encodeURIComponent\(target\.accountId\)\}\/conversations\/\$\{encodeURIComponent\(conversationId\)\}\/messages\/\$\{encodeURIComponent\(target\.messageId\)\}/);
  assert.match(x, /method:"DELETE"/);
});

test("provider failure is fail-closed and local deletion preserves message history", () => {
  const x = compact(service);
  const method = x.slice(x.indexOf("asyncdeleteMessage"), x.indexOf("asyncmarkRead"));
  assert.match(method, /selected\.direction!==MessageDirection\.OUTBOUND/);
  assert.match(method, /if\(!response\|\|\(!response\.ok&&response\.status!==404\)\)thrownewConflictException/);
  assert.ok(method.indexOf("response.status!==404") < method.indexOf("softDeleteMetadata"));
  assert.match(method, /message\.update/);
  assert.doesNotMatch(method, /message\.delete(?:Many)?\(/);
  assert.match(method, /auditLog\.create/);
});

test("local deletion never releases another delivery attempt or detaches historical files", () => {
  const x = compact(service);
  const method = x.slice(x.indexOf("asyncdeleteMessage"), x.indexOf("asyncmarkRead"));
  assert.match(method, /pg_advisory_xact_lock\(hashtextextended\(\$\{"message-send:"\+selected\.conversationId\},0\)\)/);
  assert.match(method, /status:\{in:\["PENDING","UNCERTAIN"\]\}/);
  assert.match(method, /Результатотправкиещёпроверяется/);
  assert.doesNotMatch(method, /messageDeliveryAttempt\.updateMany/);
  assert.doesNotMatch(method, /communicationAttachment\.updateMany/);
});

test("draft autosave deterministically reuses the single visible draft after deletion", () => {
  const x = compact(service);
  const method = x.slice(x.indexOf("asyncupdateDraft"), x.indexOf("asyncsend("));
  assert.match(method, /pg_advisory_xact_lock/);
  assert.match(method, /message\.findMany\(\{where:\{conversationId:conversation\.id,status:MessageStatus\.DRAFT,direction:MessageDirection\.OUTBOUND,metadata:\{path:\["composerDraftKey"\],equals:draftKey\}\},orderBy:\[\{createdAt:"desc"\},\{id:"desc"\}\]\}\)/);
  assert.match(method, /candidates\.find\(candidate=>!isSoftDeletedMessage\(candidate\.metadata\)\)\|\|null/);
  assert.match(method, /if\(candidates\.some\(candidate=>isSoftDeletedMessage\(candidate\.metadata\)\)\)thrownewConflictException\("Черновикужеудалён"\)/);
  assert.match(method, /existing\?awaittx\.message\.update/);
  assert.match(method, /:awaittx\.message\.create/);

  const deleted = { id: "draft-1", createdAt: 1, metadata: { composerDraftKey: "key", deletion: { deletedAt: "2026-09-05T12:00:00.000Z" } } };
  const replacement = { id: "draft-2", createdAt: 2, metadata: { composerDraftKey: "key" } };
  const visible = candidate => !candidate.metadata.deletion?.deletedAt;
  assert.equal([deleted].sort((a,b)=>b.createdAt-a.createdAt).find(visible), undefined);
  assert.equal([replacement,deleted].sort((a,b)=>b.createdAt-a.createdAt).find(visible)?.id, "draft-2");
  assert.equal([replacement,deleted].filter(visible).length, 1);
});

test("late autosave cannot resurrect a deleted composer key", () => {
  const x = compact(service);
  const method = x.slice(x.indexOf("asyncupdateDraft"), x.indexOf("asyncsend("));
  assert.ok(method.indexOf("candidates.some(candidate=>isSoftDeletedMessage(candidate.metadata))") < method.indexOf("message.create"));
  const saveAfterDeletion = candidates => {
    if (candidates.some(candidate => candidate.metadata.deletion?.deletedAt)) return "CONFLICT";
    const existing = candidates.find(candidate => !candidate.metadata.deletion?.deletedAt);
    return existing ? "UPDATE" : "CREATE";
  };
  assert.equal(saveAfterDeletion([{ metadata: { deletion: { deletedAt: "2026-09-05T12:00:00.000Z" } } }]), "CONFLICT");
  assert.equal(saveAfterDeletion([{ metadata: {} }, { metadata: { deletion: { deletedAt: "2026-09-05T12:00:00.000Z" } } }]), "CONFLICT");
  assert.equal(saveAfterDeletion([]), "CREATE");
});

test("soft-deleted messages stay out of AI context and selected reply inputs", async () => {
  const contextBuilder = compact(await read("../src/intelligence/context-builder.service.ts"));
  const x = compact(service);
  assert.match(contextBuilder, /while\(visible\.length<30\)/);
  assert.match(contextBuilder, /filter\(message=>!isSoftDeletedMessage\(message\.metadata\)\)/);
  assert.match(x, /visibleSelected=selected\.filter\(message=>!isSoftDeletedMessage\(message\.metadata\)\)/);
  assert.match(x, /if\(visibleSelected\.length!==selectedIds\.length\)thrownewBadRequestException/);
});

test("soft-deleted messages are excluded from list previews, detail, and attachment downloads", () => {
  const x = compact(service);
  const list = x.slice(x.indexOf("asynclist"), x.indexOf("templates()"));
  const detail = x.slice(x.indexOf("privateasynclatestVisibleMessages"), x.indexOf("asyncuploadAttachment"));
  const download = x.slice(x.indexOf("asyncdownloadMessageAttachment"), x.indexOf("asyncReact"));
  assert.match(list, /filter\(message=>!isSoftDeletedMessage\(message\.metadata\)/);
  assert.match(detail, /!isSoftDeletedMessage\(message\.metadata\)/);
  assert.match(detail, /message\.replyToMessage&&!isSoftDeletedMessage\(message\.replyToMessage\.metadata\)/);
  assert.match(detail, /:null/);
  assert.match(download, /isSoftDeletedMessage\(message\.metadata/);
});
