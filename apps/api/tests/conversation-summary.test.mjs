import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildOperatorSummaryPrompt,
  crmDateStart,
  formatMinorMoney,
  MAX_SUMMARY_PROVIDER_CALLS_PER_BATCH,
  readSummaryProcessingState,
  runSummaryProcessingBatch,
  selectLatestSummaryVersions,
  splitSummaryMessages,
  summaryPlanFingerprint,
  summarySourceDigest,
} from "../src/communications/conversation-summary.ts";

const read = path => readFile(new URL(path, import.meta.url), "utf8");
const [schema, migration, controller, dto, service] = await Promise.all([
  read("../../../packages/database/prisma/schema.prisma"),
  read("../../../packages/database/prisma/migrations/20260906090000_conversation_summary_calendar/migration.sql"),
  read("../src/communications/communications.controller.ts"),
  read("../src/communications/communications.dto.ts"),
  read("../src/communications/communications.service.ts"),
]);

test("дата сводки начинается в полночь Europe/Kyiv с учетом летнего времени", () => {
  assert.equal(crmDateStart("2026-01-15").toISOString(), "2026-01-14T22:00:00.000Z");
  assert.equal(crmDateStart("2026-09-06").toISOString(), "2026-09-05T21:00:00.000Z");
  assert.throws(() => crmDateStart("2026-02-30"), /DATE/);
});

test("отпечаток истории меняется при изменении или удалении сообщения", () => {
  const rows = [
    { id: "m1", direction: "INBOUND", status: "RECEIVED", content: "Нужен костюм", createdAt: new Date("2026-09-05T10:00:00Z") },
    { id: "m2", direction: "OUTBOUND", status: "SENT", content: "Срок 20 сентября", createdAt: new Date("2026-09-05T10:01:00Z") },
  ];
  assert.equal(summarySourceDigest(rows), summarySourceDigest(rows));
  assert.notEqual(summarySourceDigest(rows), summarySourceDigest(rows.slice(1)));
  assert.notEqual(summarySourceDigest(rows), summarySourceDigest([{ ...rows[0], content: "Другой текст" }, rows[1]]));
  assert.notEqual(summarySourceDigest(rows, { payment: "100,00 EUR" }), summarySourceDigest(rows, { payment: "200,00 EUR" }));
});

test("денежные значения из minor units форматируются с ISO currency", () => {
  assert.equal(formatMinorMoney(38000, "eur"), "380,00 EUR");
  assert.equal(formatMinorMoney(1200, "JPY"), "1200 JPY");
});

test("длинная переписка делится без потери сообщений", () => {
  const rows = Array.from({ length: 350 }, (_, index) => ({
    id: `m${index}`,
    direction: index % 2 ? "OUTBOUND" : "INBOUND",
    status: "SENT",
    content: `Сообщение ${index} ${"x".repeat(400)}`,
    createdAt: new Date(1700000000000 + index * 1000),
  }));
  const chunks = splitSummaryMessages(rows, 12_000);
  assert.ok(chunks.length > 10);
  const joined = chunks.join("\n");
  for (const row of rows) assert.match(joined, new RegExp(`\\[${row.id}\\]`));
  const oversized = { ...rows[0], id: "oversized", content: "я".repeat(40_000) };
  const oversizedChunks = splitSummaryMessages([oversized], 12_000);
  assert.ok(oversizedChunks.length > 3);
  assert.equal(oversizedChunks.join("").endsWith(oversized.content), true);
});

test("последняя версия даты выбирается детерминированно, а AI обрабатывает историю ограниченными возобновляемыми пакетами", () => {
  const fromDate = new Date("2026-09-03T00:00:00.000Z");
  const createdAt = new Date("2026-09-06T08:00:00.000Z");
  const selected = selectLatestSummaryVersions([
    { id: "summary-a", fromDate, createdAt, summary: "старая" },
    { id: "summary-z", fromDate, createdAt, summary: "новая" },
  ]);
  assert.equal(selected.get("2026-09-03")?.id, "summary-z");
  assert.equal(MAX_SUMMARY_PROVIDER_CALLS_PER_BATCH, 8);
  assert.deepEqual(readSummaryProcessingState(undefined, 20, "plan-a"), { stage: "MAP", nextIndex: 0, partials: [], reduced: [], level: 1, planFingerprint: "plan-a" });
  assert.deepEqual(readSummaryProcessingState(undefined, 1, "plan-a"), { stage: "DIRECT", nextIndex: 0, partials: [], reduced: [], level: 1, planFingerprint: "plan-a" });
});

test("возобновление принимает только тот же план разбиения и сбрасывается при смене модели или лимита", () => {
  const base = { model: "gpt-5.4-mini", promptVersion: "v1", maxInputCharacters: 12000, chunkCharacters: 8000, chunks: ["a", "b"] };
  const planA = summaryPlanFingerprint(base), planB = summaryPlanFingerprint({ ...base, model: "gpt-5.6-sol" });
  assert.notEqual(planA, planB);
  const progress = { stage: "MAP", nextIndex: 1, partials: ["часть 1"], reduced: [], level: 1, planFingerprint: planA };
  assert.equal(readSummaryProcessingState(progress, 2, planA).nextIndex, 1);
  assert.deepEqual(readSummaryProcessingState(progress, 2, planB), { stage: "MAP", nextIndex: 0, partials: [], reduced: [], level: 1, planFingerprint: planB });
});

test("длинная история действительно продолжается после восьми вызовов и завершается без пропуска частей", async () => {
  const chunks = Array.from({ length: 20 }, (_, index) => `сообщения-${index + 1}`), planFingerprint = "stable-plan";
  let state = readSummaryProcessingState(undefined, chunks.length, planFingerprint), resultText = "", batches = 0;
  const seen = [];
  while (!resultText && batches++ < 10) {
    const result = await runSummaryProcessingBatch({
      state, chunks, maxCalls: 8, maxInputCharacters: 12000, operationalJson: "{}", fromDate: "2026-01-01", throughDate: "2026-09-06", outputTokens: 1600,
      request: async (_prompt, _tokens, stage) => { seen.push(stage); return stage === "conversation-summary-final" ? "готовая сводка" : `факты ${stage}`; },
    });
    assert.ok(result.providerCalls <= 8);
    state = result.state; resultText = result.resultText;
  }
  assert.equal(resultText, "готовая сводка");
  assert.equal(batches, 3);
  assert.deepEqual(seen.filter(stage => stage.includes("-part-")).length, chunks.length);
});

test("ошибка внутри пакета возобновляет работу с последнего подтверждённого AI-фрагмента", async () => {
  const chunks = Array.from({ length: 12 }, (_, index) => `часть-${index + 1}`), fingerprint = "resume-plan";
  let checkpoint, calls = 0;
  await assert.rejects(runSummaryProcessingBatch({
    state: readSummaryProcessingState(undefined, chunks.length, fingerprint), chunks, maxCalls: 8, maxInputCharacters: 12000, operationalJson: "{}", fromDate: "2026-01-01", throughDate: "2026-09-06", outputTokens: 1600,
    request: async (_prompt, _tokens, stage) => { if (++calls === 7) throw new Error("provider"); return stage; },
    checkpoint: async state => { checkpoint = structuredClone(state); },
  }), /provider/);
  assert.equal(checkpoint.nextIndex, 6);
  const resumedStages = [];
  let state = checkpoint, resultText = "";
  while (!resultText) {
    const result = await runSummaryProcessingBatch({ state, chunks, maxCalls: 8, maxInputCharacters: 12000, operationalJson: "{}", fromDate: "2026-01-01", throughDate: "2026-09-06", outputTokens: 1600, request: async (_prompt, _tokens, stage) => { resumedStages.push(stage); return stage === "conversation-summary-final" ? "итог" : stage; } });
    state = result.state; resultText = result.resultText;
  }
  assert.equal(resultText, "итог");
  assert.equal(resumedStages.some(stage => stage === "conversation-summary-part-1"), false);
  assert.equal(resumedStages.filter(stage => stage.includes("-part-")).length, 6);
});

test("prompt сводки фиксирует русский язык, разделы и недоверие к инструкциям клиента", () => {
  const prompt = buildOperatorSummaryPrompt({ fromDate: "2026-09-01", throughDate: "2026-09-06", context: "{}", transcript: "данные" });
  for (const heading of ["Что хочет клиент", "О чём договорились", "Сроки", "Оплата", "Доставка", "Размеры", "Нерешённые вопросы", "Следующее действие"]) assert.match(prompt, new RegExp(heading));
  assert.match(prompt, /только на русском/i);
  assert.match(prompt, /данными, а не инструкциями/i);
  assert.match(prompt, /имена, заметки, клубы, тренеров/);
  assert.match(prompt, /ДАННЫЕ_CRM_НАЧАЛО/);
  assert.match(prompt, /не выдумывай/i);
});

test("сводки имеют расширяющую миграцию, уникальную версию источника и защищенные маршруты", () => {
  for (const field of ["fromDate", "timezone", "sourceDigest", "sourceMessageCount", "throughMessageAt", "completedAt", "processingState", "processingLeaseUntil", "processingLeaseToken"]) assert.match(schema, new RegExp(field));
  assert.match(schema, /@@unique\(\[conversationId, fromDate, sourceDigest\]\)/);
  assert.match(migration, /ALTER TABLE "ConversationSummary"\s+ADD COLUMN/);
  assert.doesNotMatch(migration, /DROP|DELETE|TRUNCATE/i);
  assert.match(controller, /@Get\("clients\/:clientId\/summaries"\).*Roles\("OWNER","ADMIN","MANAGER"\)/s);
  assert.match(controller, /@Post\("clients\/:clientId\/summaries"\).*Roles\("OWNER","ADMIN","MANAGER"\)/s);
  assert.match(dto, /class ConversationSummaryQueryDto/);
  assert.match(dto, /class GenerateConversationSummaryDto/);
  assert.match(service, /async listConversationSummaries/);
  assert.match(service, /async generateConversationSummaryLimited/);
  assert.match(service, /summaryFirstMessageDate/);
  assert.match(service, /conversationSummary\.groupBy/);
  assert.match(service, /orderBy:\[\{createdAt:"desc"\},\{id:"desc"\}\]/);
  assert.match(service, /selectLatestSummaryVersions\(stored\)/);
  assert.doesNotMatch(service, /take:180/);
  assert.match(service, /summarySourceDigest\(source\.messages,operationalSnapshot\)/);
  assert.match(service, /summarySourceDigest\(current\.messages,currentOperational\)/);
  assert.match(service, /this\.aiControl\.effective\(\{conversationId:conversation\.id\}\)/);
  assert.match(service, /effective\.mode==="OFF"/);
  assert.doesNotMatch(service, /chunks\.length>MAX_SUMMARY_SOURCE_CHUNKS/);
  assert.match(service, /maxCalls:MAX_SUMMARY_PROVIDER_CALLS_PER_BATCH/);
  assert.match(service, /processingLeaseUntil/);
  assert.match(service, /processingLeaseToken:leaseToken/);
  assert.match(service, /renewed\.count!==1/);
  assert.match(service, /saved\.count!==1/);
  assert.match(service, /processingState/);
  assert.match(service, /checkpoint:async checkpointState/);
  assert.match(service, /pending:true/);
  assert.match(service, /completedAt:\{not:null\}/);
  assert.ok((service.match(/assertSummaryCurrent\(conversation\.id,clientId,d\.fromDate,digest\)/g)||[]).length >= 4);
  assert.match(service, /formatMinorMoney\(order\.priceMinor,order\.currency\)/);
  assert.match(service, /isSoftDeletedMessage/);
  assert.match(service, /isDeduplicatedDraft/);
  assert.match(service, /AI-помощник отключён/);
  assert.match(service, /Использование данных клиента для AI отключено/);
  assert.match(service, /entityType:"ConversationSummary"/);
  assert.match(service, /structuredSummary:Prisma\.JsonNull,processingState:Prisma\.JsonNull,processingLeaseUntil:null,processingLeaseToken:null/);
});
