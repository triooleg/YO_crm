import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const source = await readFile(new URL("../src/communications/meta-story-media.ts", import.meta.url), "utf8");
const javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} }, require = createRequire(import.meta.url);
vm.runInNewContext(javascript, { module, exports: module.exports, require, URL, Error });
const { materializeMetaStoryReply, metaStoryAttachment, persistMaterializedMetaStory, trustedMetaStoryMediaUrl } = module.exports;

test("accepts only HTTPS media URLs owned by Meta", () => {
  assert.equal(trustedMetaStoryMediaUrl("https://lookaside.fbsbx.com/story.jpg"), "https://lookaside.fbsbx.com/story.jpg");
  assert.equal(trustedMetaStoryMediaUrl("https://scontent-ams4-1.cdninstagram.com/story.jpg"), "https://scontent-ams4-1.cdninstagram.com/story.jpg");
  assert.equal(trustedMetaStoryMediaUrl("https://evil.example/story.jpg"), undefined);
  assert.equal(trustedMetaStoryMediaUrl("http://lookaside.fbsbx.com/story.jpg"), undefined);
});

test("replaces a Meta story URL with a local durable URL and retains context", async () => {
  const event = { channel: "INSTAGRAM", metadata: { replyTo: { kind: "story", storyId: "story-1", storyUrl: "https://lookaside.fbsbx.com/story.jpg" } } };
  const result = await materializeMetaStoryReply(event, {
    download: async url => ({ body: new Uint8Array([1, 2, 3]), contentType: "image/jpeg", sourceUrl: url }),
    store: async () => ({ path: "stored-story.jpg", url: "/api/communications/files/stored-story.jpg" }),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(result.event.metadata.replyTo)), { kind: "story", storyId: "story-1", storyUrl: "/api/communications/files/stored-story.jpg", storyMediaType: "image", storyMimeType: "image/jpeg" });
  assert.deepEqual(JSON.parse(JSON.stringify(result.paths)), ["stored-story.jpg"]);
});

test("keeps text and story context when Meta media cannot be downloaded", async () => {
  const event = { channel: "FACEBOOK", content: "Цена?", metadata: { replyTo: { kind: "story", storyUrl: "https://lookaside.fbsbx.com/story.jpg" } } };
  const result = await materializeMetaStoryReply(event, {
    download: async () => { throw new Error("expired"); },
    store: async () => { throw new Error("must not store"); },
  });
  assert.equal(result.event, event);
  assert.deepEqual(JSON.parse(JSON.stringify(result.paths)), []);
  assert.equal(result.error?.message, "expired");
});

test("registers durable story media for lifecycle cleanup", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(metaStoryAttachment({ replyTo: { kind: "story", storyUrl: "/api/communications/files/story-1.mp4", storyMediaType: "video", storyMimeType: "video/mp4" } }))), {
    type: "video",
    url: "/api/communications/files/story-1.mp4",
    mimeType: "video/mp4",
    context: "story",
  });
  assert.equal(metaStoryAttachment({ replyTo: { kind: "story", storyUrl: "https://lookaside.fbsbx.com/story.jpg", storyMediaType: "image" } }), undefined);
});

test("removes materialized story media when persistence reports a duplicate", async () => {
  const removed = [];
  const result = await persistMaterializedMetaStory(["story.jpg"], async () => false, async path => { removed.push(path); });
  assert.equal(result, false);
  assert.deepEqual(removed, ["story.jpg"]);
});
