import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
const schema = await readFile(
  new URL("../../../packages/database/prisma/schema.prisma", import.meta.url),
  "utf8",
);
const app = await readFile(
  new URL("../src/app.module.ts", import.meta.url),
  "utf8",
);
const controller = await readFile(
  new URL(
    "../src/communications/communications.controller.ts",
    import.meta.url,
  ),
  "utf8",
);
const dto = (
  await readFile(
    new URL("../src/communications/communications.dto.ts", import.meta.url),
    "utf8",
  )
).replace(/\s+/g, "");
const service = (
  await readFile(
    new URL("../src/communications/communications.service.ts", import.meta.url),
    "utf8",
  )
).replace(/\s+/g, "");
test("communications persist conversations and messages", () => {
  assert.match(schema, /model Conversation/);
  assert.match(schema, /model Message/);
  assert.match(schema, /clientId\s+String/);
  assert.match(schema, /direction\s+MessageDirection/);
  assert.match(schema, /content\s+String/);
  assert.match(schema, /@@index\(\[conversationId, createdAt\]\)/);
});
test("communications API and AI assistant are registered", () => {
  assert.match(app, /CommunicationsController/);
  assert.match(app, /CommunicationsService/);
  assert.match(app, /AiAssistantController/);
  assert.match(app, /AiAssistantService/);
});
test("AI settings never expose the API key", () => {
  assert.doesNotMatch(app, /OPENAI_API_KEY.*return|return.*OPENAI_API_KEY/);
});
test("communications reads require CRM roles and validated query", () => {
  assert.match(controller, /@Get\(\)@Roles\("OWNER","ADMIN","MANAGER"\)/);
  assert.match(controller, /@Query\(\)query:ConversationQueryDto/);
  assert.match(dto, /@IsEnum\(ContactChannel\)channel/);
});
test("message templates are archived, role protected and audited", () => {
  assert.match(schema, /model MessageTemplate/);
  assert.match(schema, /content\s+String/);
  assert.match(schema, /archivedAt\s+DateTime\?/);
  assert.match(
    controller,
    /@Get\("templates"\)@Roles\("OWNER","ADMIN","MANAGER"\)/,
  );
  assert.match(controller, /@Post\("templates"\)@Roles\("OWNER","ADMIN"\)/);
  assert.match(
    controller,
    /@Patch\("templates\/:id"\)@Roles\("OWNER","ADMIN"\)/,
  );
  assert.match(
    controller,
    /@Post\("templates\/:id\/archive"\)@Roles\("OWNER","ADMIN"\)/,
  );
  assert.match(service, /entityType:"MessageTemplate"/);
  assert.doesNotMatch(controller, /@Delete\("templates/);
});
test("channel credentials remain write-only and only safe status is returned", () => {
  assert.match(controller, /@Get\("integrations"\)@Roles\("OWNER","ADMIN"\)/);
  assert.match(
    controller,
    /@Patch\("integrations\/:channel"\)@Roles\("OWNER","ADMIN"\)/,
  );
  assert.match(dto, /ChatwootIntegrationDto/);
  assert.match(dto, /EmailIntegrationDto/);
  assert.match(service, /accessTokenConfigured/);
  assert.match(service, /passwordConfigured/);
  assert.match(service, /NOT_CONNECTED/);
  assert.doesNotMatch(service, /accessToken:\s*v\.accessToken/);
  assert.doesNotMatch(service, /password:\s*v\.password/);
});
test("conversation reads do not mutate unread state", () => {
  const x = service.slice(
    service.indexOf("async detail"),
    service.indexOf("async send"),
  );
  assert.doesNotMatch(x, /conversation\.update|unreadCount:0[^}]*update/);
});
test("AI requires opt in and separate context consent", () => {
  assert.match(service, /enabled:v\.enabled===true/);
  assert.match(service, /allowClientContext:v\.allowClientContext===true/);
  assert.match(dto, /@IsBoolean\(\)enabled/);
  assert.match(dto, /@IsBoolean\(\)allowClientContext/);
  assert.match(service, /cfg\.allowClientContext&&d\.clientId/);
});
test("AI is bounded and audited without message content", () => {
  assert.match(service, /ALLOWED_AI_MODELS/);
  assert.match(service, /max_output_tokens:800/);
  assert.match(service, /AbortSignal\.timeout\(15000\)/);
  assert.match(service, /entityType:"AiAssistantGeneration"/);
  assert.doesNotMatch(service, /after:\{[^}]*text:d\.text/s);
});
test("AI context is action specific and data minimal", () => {
  const x = service.slice(service.indexOf("asyncgenerate"));
  assert.match(x, /d\.action===\"REPLY\"\|\|d\.action===\"TEMPLATE\"/);
  assert.match(
    x,
    /select:\{displayName:true,language:true,country:true,orders:/,
  );
  assert.doesNotMatch(x, /client:\{[^}]*notes:/);
  assert.doesNotMatch(x, /orders\.map\(o=>\(\{[^}]*notes:/);
  assert.doesNotMatch(x, /payments:true/);
});
test("conversation and draft are created atomically", () => {
  const x = service.slice(
    service.indexOf("asyncsend"),
    service.indexOf("@Injectable()exportclassAiAssistantService"),
  );
  assert.ok(
    x.includes("$transaction(async(tx)=>{constc=awaittx.conversation.upsert"),
  );
  assert.doesNotMatch(x, /this\.p\.conversation\.upsert/);
});
test("AI requests are rate limited and concurrency bounded per user", () => {
  assert.match(service, /AI_RATE_LIMIT_PER_HOUR=20/);
  assert.match(service, /AI_CONCURRENCY_LIMIT=2/);
  const x = service.slice(
    service.indexOf("@Injectable()exportclassAiAssistantService"),
  );
  assert.match(x, /pg_advisory_xact_lock/);
  assert.match(x, /TooManyRequestsException/);
  assert.match(x, /AI_GENERATION_ATTEMPT/);
  assert.match(x, /createdAt:\{gte:/);
  assert.match(controller, /generateLimited/);
});
test("AI API token is write-only, encrypted and removable", () => {
  assert.match(dto, /apiKey\?:string/);
  assert.match(dto, /removeApiKey\?:boolean/);
  assert.match(service, /encryptSecret/);
  assert.match(service, /decryptSecret/);
  assert.match(service, /apiKeyEncrypted/);
  assert.match(service, /apiKeyDisabled/);
  assert.match(service, /deleteMany/);
  assert.doesNotMatch(service, /apiKey:\s*v\./);
  assert.doesNotMatch(service, /after:d as Prisma\.InputJsonValue/);
});
test("AI generation resolves the stored token without exposing it", () => {
  assert.match(service, /resolveApiKey/);
  assert.match(service, /process\.env\.OPENAI_API_KEY/);
  assert.match(service, /Authorization:"Bearer"\+key/);
  assert.match(controller, /@Patch\("settings"\)@Roles\("OWNER","ADMIN"\)/);
});
