import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";

const root = new URL("../../../", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");
const [schema, communications, memory, context, tools, runs, flags, worker, provider] = await Promise.all([
  read("packages/database/prisma/schema.prisma"), read("apps/api/src/communications/communications.service.ts"),
  read("apps/api/src/intelligence/customer-memory.service.ts"), read("apps/api/src/intelligence/context-builder.service.ts"),
  read("apps/api/src/intelligence/tool.service.ts"), read("apps/api/src/intelligence/ai-run.service.ts"),
  read("apps/api/src/intelligence/ai-feature-flags.service.ts"), read("apps/api/src/intelligence/ai-job-worker.service.ts"),
  read("apps/api/src/intelligence/ai-provider.ts"),
]);

test("message storage preserves replayable source and normalized attachments", () => {
  for (const field of ["rawPayload", "normalizedText", "messageType", "receivedAt", "replyToMessageId", "aiProcessedAt"]) assert.match(schema, new RegExp(field));
  assert.match(schema, /model MessageAttachment/);
  assert.match(schema, /model WebhookEnvelope/);
  assert.match(communications, /replayFragment\(event/);
  assert.match(communications, /tx\.webhookEnvelope\.create/);
  assert.match(communications, /rawPayload, webhookEnvelopeId:envelope\.id/);
  assert.match(communications, /tx\.messageAttachment\.create/);
});

test("webhook commits an outbox job and never calls a provider", () => {
  assert.match(communications, /tx\.aiJob\.create/);
  assert.doesNotMatch(communications.slice(communications.indexOf("private async persistInbound"), communications.indexOf("async markRead")), /requestOpenAi|fetch\(/);
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
});

test("memory update supersedes the prior active value with provenance", () => {
  assert.match(memory, /sourceType.*sourceId/s);
  assert.match(memory, /AiRecordStatus\.SUPERSEDED/);
  assert.match(memory, /supersededById: next\.id/);
  assert.match(memory, /status: AiRecordStatus\.ACTIVE/);
  assert.doesNotMatch(memory, /status: \{ in: \[AiRecordStatus\.ACTIVE, AiRecordStatus\.VERIFIED\] \}/);
  assert.match(memory, /sourceMessageId.*conversation: \{ clientId: input\.clientId \}/s);
  assert.match(memory, /AI_MEMORY_CANDIDATE_CREATED/);
});

test("facts, agreements, knowledge versions, runs and feedback are first-class", () => {
  for (const model of ["MessageAnalysis", "CustomerMemory", "ConversationFact", "Agreement", "KnowledgeCategory", "KnowledgeItem", "KnowledgeVersion", "AiPrompt", "AiRun", "AiResponseFeedback", "ConversationSummary"]) assert.match(schema, new RegExp(`model ${model}`));
  assert.match(schema, /customerMessageId/);
  assert.match(schema, /staffConfirmationMessageId/);
  assert.match(runs, /generatedOutput/);
  assert.match(communications, /wasEdited:feedback\.draftText!==content/);
});

test("context is a whitelist of CRM truth and sourced intelligence", () => {
  for (const source of ["paymentStatus", "productionStatus", "shippingStatus", "customerMemory", "conversationFact", "agreement", "knowledgeItem"]) assert.match(context, new RegExp(source));
  assert.doesNotMatch(context, /appSetting|apiKey|accessToken|rawPayload|passwordHash/);
  assert.match(context, /status: AiRecordStatus\.VERIFIED, staffConfirmationMessageId: \{ not: null \}/);
  assert.match(context, /version\.version === item\.currentVersion/);
  assert.match(context, /verifiedMemories.*candidateMemories.*verifiedFacts.*candidateFacts/s);
});

test("provider is model-neutral and tool permissions fail closed", () => {
  assert.match(provider, /interface LlmProvider/);
  assert.match(provider, /generateStructured/);
  assert.match(provider, /embed/);
  assert.match(tools, /\?\? "HIGH_RISK"/);
  assert.match(tools, /REQUIRES_APPROVAL/);
  assert.match(tools, /HIGH_RISK/);
});

test("disabled mode and automatic messaging fail closed", () => {
  assert.match(flags, /if \(!flags\.aiEnabled\) return AiMode\.OFF/);
  assert.match(flags, /AI_AUTO_REPLY_ENABLED", false/);
  assert.doesNotMatch(worker, /sendMessage|communications.*send/);
});

test("AI draft feedback is scoped to the current client and conversation", () => {
  assert.match(communications, /aiRun:\{clientId,conversationId:conversation\.id,operation:"REPLY",status:AiRunStatus\.COMPLETED\}/);
  assert.match(communications, /sentMessageId:null/);
  assert.match(communications, /reserveAiFeedback\(tx,\{aiRunId:d\.aiRunId,clientId,conversationId:conversation\.id\}\)/);
  assert.match(communications, /conversationIds\.length!==1/);
  assert.match(communications, /sourceRun\.conversationId!==selectedConversationId/);
  assert.match(communications, /sameMessageSet\(sourceRun\.retrievedMessageIds,selectedIds\)/);
  assert.match(communications, /verifiedMemories\|\|\[\].*candidateMemories\|\|\[\]/s);
  assert.match(communications, /sourceRun=await this\.p\.aiRun\.findFirst/);
  assert.match(communications, /return \{text:resultText,targetLanguage,aiRunId:sourceRun\.id,translationRunId:run\.id\}/);
});

test("AI outbox recovers stale locks and retries before dead letter", () => {
  assert.match(worker, /status:AiJobStatus\.RUNNING,lockedAt:\{lt:staleBefore\}/);
  assert.match(worker, /retry=job\.attempts<3/);
  assert.match(worker, /retry\?AiJobStatus\.PENDING:AiJobStatus\.FAILED/);
  assert.match(worker, /setInterval\(\(\) => void this\.tick\(\), 5_000\)/);
});

test("AI outbox obeys both the master switch and the analysis switch", () => {
  const isolated = worker.slice(worker.indexOf("export function shouldProcessAiJobs"), worker.indexOf("@Injectable"));
  const javascript = ts.transpileModule(isolated, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: createRequire(import.meta.url), AiRunStatus: { COMPLETED: "COMPLETED" } });
  assert.equal(module.exports.shouldProcessAiJobs({ aiEnabled: false, messageAnalysisEnabled: true }), false);
  assert.equal(module.exports.shouldProcessAiJobs({ aiEnabled: true, messageAnalysisEnabled: false }), false);
  assert.equal(module.exports.shouldProcessAiJobs({ aiEnabled: true, messageAnalysisEnabled: true }), true);
});

test("concurrent AI feedback reservations allow exactly one sender", async () => {
  const reservation = await read("apps/api/src/intelligence/ai-feedback-reservation.ts");
  const isolated = reservation.slice(reservation.indexOf("export async function reserveAiFeedback"));
  const javascript = ts.transpileModule(isolated, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: createRequire(import.meta.url), AiRunStatus: { COMPLETED: "COMPLETED" } });
  let available = true;
  const tx = { aiResponseFeedback: { updateMany: async () => {
    await new Promise(resolve => setImmediate(resolve));
    if (!available) return { count: 0 };
    available = false;
    return { count: 1 };
  } } };
  const input = { aiRunId: "run", clientId: "client", conversationId: "conversation" };
  const results = await Promise.all([module.exports.reserveAiFeedback(tx, input), module.exports.reserveAiFeedback(tx, input)]);
  assert.deepEqual(results.sort(), [false, true]);
});

test("AI finalize lineage rejects a different message set in the same conversation", async () => {
  const lineage = await read("apps/api/src/intelligence/ai-lineage.ts");
  const javascript = ts.transpileModule(lineage, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: createRequire(import.meta.url) });
  assert.equal(module.exports.sameMessageSet(["m1", "m2"], ["m2", "m1"]), true);
  assert.equal(module.exports.sameMessageSet(["m1", "m2"], ["m1", "m3"]), false);
  assert.equal(module.exports.sameMessageSet(["m1", "m2"], ["m1"]), false);
});

test("deterministic analysis extracts language and intent without a paid API", async () => {
  const source = await read("apps/api/src/intelligence/conversation-analyzer.service.ts");
  const isolated = source.slice(source.indexOf("export function deterministicAnalysis"), source.indexOf("@Injectable"));
  const javascript = ts.transpileModule(isolated, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(javascript, { module, exports: module.exports, require: createRequire(import.meta.url) });
  assert.deepEqual(JSON.parse(JSON.stringify(module.exports.deterministicAnalysis("When will my order be delivered?"))), { language: "en", intent: "COMMERCIAL_INQUIRY", requiresReply: true, commercialIntent: true, confidence: 0.65 });
});
