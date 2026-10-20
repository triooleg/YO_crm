import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";
import crypto from "node:crypto";

const source = await readFile(new URL("../src/communications/meta-data-deletion.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} }, require = createRequire(import.meta.url);
vm.runInNewContext(javascript, { module, exports: module.exports, require, Buffer });
const { parseMetaDataDeletionRequest } = module.exports;

function signedRequest(payload, secret = "app-secret") {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${signature}.${encoded}`;
}

test("verifies Meta signed_request and returns the scoped user id", () => {
  const result = parseMetaDataDeletionRequest(signedRequest({ algorithm: "HMAC-SHA256", user_id: "meta-user-1", issued_at: 1000 }), "app-secret", 1000);
  assert.equal(result.userId, "meta-user-1");
});

test("rejects a modified signature and unsupported algorithms", () => {
  assert.throws(() => parseMetaDataDeletionRequest(`bad.${Buffer.from(JSON.stringify({ algorithm: "HMAC-SHA256", user_id: "1" })).toString("base64url")}`, "app-secret"));
  assert.throws(() => parseMetaDataDeletionRequest(signedRequest({ algorithm: "none", user_id: "1", issued_at: 1000 }), "app-secret", 1000));
  assert.throws(() => parseMetaDataDeletionRequest(signedRequest({ algorithm: "HMAC-SHA256", user_id: "1", issued_at: 1 }), "app-secret", 100000));
});

test("exposes a public callback that queues an audited request without storing the Meta user id", async () => {
  const [controller, service] = await Promise.all([
    readFile(new URL("../src/communications/communications.controller.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/communications/communications.service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(controller, /@Post\("data-deletion"\)/);
  assert.match(controller, /@Get\("data-deletion\/:code"\)/);
  assert.match(service, /integration\.meta\.data-deletion/);
  assert.match(service, /createHmac\("sha256", appSecret\)\.update\(`meta-data-deletion:\$\{userId\}`\)/);
  assert.match(service, /encryptedIdentity\s*=\s*encryptSecret\(userId\)/);
  assert.doesNotMatch(service, /after:\s*\{[^}]*userId/);
  assert.match(service, /entityType:\s*"MetaDataDeletion"/);
  assert.match(service, /completeMetaDataDeletion/);
  assert.match(service, /Удалено по запросу пользователя/);
});

test("commits anonymization before deleting files and completes only after file cleanup", async () => {
  const service = await readFile(new URL("../src/communications/communications.service.ts", import.meta.url), "utf8");
  const processing = service.indexOf('status: "PROCESSING"');
  const attachmentRows = service.indexOf("taskAttachment.deleteMany");
  const unlinkFiles = service.indexOf("await unlink", processing);
  const completed = service.indexOf('status: "COMPLETED"', unlinkFiles);

  assert.ok(processing >= 0, "request must enter a recoverable processing state");
  assert.ok(attachmentRows >= 0 && attachmentRows < unlinkFiles, "database references must be removed before physical files");
  assert.ok(processing < unlinkFiles, "the processing state must be committed before physical file deletion");
  assert.ok(unlinkFiles < completed, "completion must be recorded only after physical file deletion");
  assert.match(service, /запрос останется в обработке и может быть повторён/);
  assert.match(service, /value\.status === "PROCESSING"/);
  assert.match(service, /conversationSummary\.updateMany\(\{where:\{conversation:\{clientId\}\},data:\{summary:redacted,structuredSummary:Prisma\.JsonNull,processingState:Prisma\.JsonNull,processingLeaseUntil:null,processingLeaseToken:null\}\}\)/);
});
