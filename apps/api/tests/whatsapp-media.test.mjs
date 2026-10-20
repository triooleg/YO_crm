import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/communications/whatsapp-media.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(javascript, { module, exports: module.exports, URL, Buffer, ReadableStream, Uint8Array, Error });
const { boundedWhatsappMedia, materializeWhatsappAttachments, persistMaterializedWhatsapp, trustedWhatsappMediaUrl } = module.exports;

const stream = (...chunks) => new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(Uint8Array.from(chunk)); controller.close(); } });

test("WhatsApp media is stored with a durable same-origin URL", async () => {
  const stored = [];
  const result = await materializeWhatsappAttachments([{ type: "audio", mediaId: "123" }], true, {
    lookup: async () => ({ url: "https://lookaside.fbsbx.com/media/123", mimeType: "audio/mpeg", fileSize: 3 }),
    download: async () => ({ body: stream([1, 2, 3]), contentType: "audio/mpeg" }),
    store: async (body, extension) => { stored.push([body.length, extension]); return { path: "safe.mp3", url: "/api/communications/files/safe.mp3" }; },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { attachments: [{ type: "audio", mediaId: "123", mimeType: "audio/mpeg", sizeBytes: 3, url: "/api/communications/files/safe.mp3", materializationStatus: "STORED" }], paths: ["safe.mp3"] });
  assert.deepEqual(stored, [[3, "mp3"]]);
});

test("media failure preserves the message attachment for persistence and retry", async () => {
  let stores = 0, failures = 0;
  const result = await materializeWhatsappAttachments([{ type: "image", mediaId: "456", caption: "keep me" }], true, {
    lookup: async () => ({ url: "https://evil.example/media/456", mimeType: "image/jpeg", fileSize: 3 }),
    download: async () => { throw new Error("redirect rejected"); },
    store: async () => { stores += 1; return { path: "never.jpg", url: "/never" }; },
    onFailure: () => { failures += 1; },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { attachments: [{ type: "image", mediaId: "456", caption: "keep me", materializationStatus: "FAILED" }], paths: [] });
  assert.equal(stores, 0);
  assert.equal(failures, 1);
});

test("missing token leaves media pending without losing webhook history", async () => {
  const result = await materializeWhatsappAttachments([{ type: "video", mediaId: "789" }], false, { lookup: async () => { throw new Error("unused"); }, download: async () => { throw new Error("unused"); }, store: async () => { throw new Error("unused"); } });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { attachments: [{ type: "video", mediaId: "789", materializationStatus: "PENDING" }], paths: [] });
});

test("trusted media URLs and streaming size limit fail closed", async () => {
  assert.equal(trustedWhatsappMediaUrl("https://lookaside.fbsbx.com/media/1").hostname, "lookaside.fbsbx.com");
  assert.equal(trustedWhatsappMediaUrl("https://facebook.com.evil.example/media/1"), undefined);
  assert.equal(trustedWhatsappMediaUrl("http://lookaside.fbsbx.com/media/1"), undefined);
  await assert.rejects(() => boundedWhatsappMedia(stream([1, 2, 3], [4, 5]), 4), /exceeds limit/);
});

test("durable media is cleaned after duplicate or database failure", async () => {
  const duplicateCleanup = [];
  assert.equal(await persistMaterializedWhatsapp(["a.jpg", "b.mp4"], async () => null, async path => { duplicateCleanup.push(path); }), null);
  assert.deepEqual(duplicateCleanup, ["a.jpg", "b.mp4"]);
  const failedCleanup = [];
  await assert.rejects(() => persistMaterializedWhatsapp(["c.ogg"], async () => { throw new Error("database unavailable"); }, async path => { failedCleanup.push(path); }), /database unavailable/);
  assert.deepEqual(failedCleanup, ["c.ogg"]);
});
