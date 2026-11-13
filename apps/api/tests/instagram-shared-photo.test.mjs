import test from "node:test";
import assert from "node:assert/strict";
import { loadTargetModule } from "./website-test-loader.mjs";

const { CommunicationsService } = loadTargetModule("communications/communications.service.ts");
const photoUrl = "https://lookaside.fbsbx.com/photo";

function sharedPhotoService() {
  const service = new CommunicationsService({ message: { findFirst: async () => ({
    metadata: { attachments: [{ type: "ig_post", url: photoUrl }] },
    conversation: { channel: "INSTAGRAM" },
  }) } }, {});
  service.sectionValues = async () => ({});
  return service;
}

test("stored Instagram post labelled HEIC is served using its actual JPEG format", async () => {
  const url = "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=fixture";
  const db = { message: { findFirst: async () => ({
    metadata: { attachments: [{ type: "ig_post", url }] },
    conversation: { channel: "INSTAGRAM" },
  }) } };
  const service = new CommunicationsService(db, {});
  service.sectionValues = async () => ({});
  const jpeg = Buffer.from([255, 216, 255, 217]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async requested => {
    assert.equal(String(requested), url);
    return new Response(jpeg, { headers: { "content-type": "image/heic" } });
  };
  try {
    const result = await service.downloadMessageAttachment("message", 0);
    assert.equal(result.contentType, "image/jpeg");
    assert.deepEqual(result.body, jpeg);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


const { instagramSharedPhotoPreview, renderInstagramSharedPhoto, withInstagramSharedPhotoSlot } = loadTargetModule("communications/instagram-shared-photo.ts");

test("Instagram post projection keeps its original slot and rejects non-media URLs", () => {
  assert.deepEqual(instagramSharedPhotoPreview("message", 2, "https://lookaside.fbsbx.com/photo"), {
    type: "image", sharedInstagramPhoto: true, originalUrl: "https://lookaside.fbsbx.com/photo", url: "/api/communications/messages/message/attachments/2/download?inline=1",
  });
  for (const url of ["https://www.instagram.com/p/example", "http://lookaside.fbsbx.com/a", "https://lookaside.fbsbx.com:8080/a", "https://user@lookaside.fbsbx.com/a", "https://lookaside.fbsbx.com.evil.test/a"]) {
    assert.equal(instagramSharedPhotoPreview("message", 2, url), undefined);
  }
});

test("shared photos accept browser-safe signatures and reject non-image bodies", () => {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  assert.deepEqual(renderInstagramSharedPhoto(png), { body: png, contentType: "image/png", extension: "png" });
  for (const unsupported of ["<html>", "0000ftypheic", "RIFFxxxxAVI "]) {
    assert.equal(renderInstagramSharedPhoto(Buffer.from(unsupported)), undefined);
  }
});

test("the stored Instagram attachment route never follows a redirect off Meta CDN", async () => {
  const url = "https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=fixture";
  const service = new CommunicationsService({ message: { findFirst: async () => ({
    metadata: { attachments: [{ type: "ig_post", url }] },
    conversation: { channel: "INSTAGRAM" },
  }) } }, {});
  service.sectionValues = async () => ({ baseUrl: "https://chat.example.test" });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async requested => {
    assert.equal(String(requested), url);
    return new Response(null, { status: 302, headers: { location: "https://chat.example.test/private" } });
  };
  try {
    await assert.rejects(service.downloadMessageAttachment("message", 0), { status: 502 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("shared photo queue caps work before fetching and resumes waiting loads", async () => {
  let active = 0, maxActive = 0, finish;
  const hold = new Promise(resolve => { finish = resolve; });
  const work = () => withInstagramSharedPhotoSlot(async () => {
    maxActive = Math.max(maxActive, ++active);
    await hold;
    active--;
  });
  const requests = Array.from({ length: 6 }, work);
  assert.equal(active, 2);
  await assert.rejects(work(), /queue is full/);
  finish();
  await Promise.all(requests);
  await work();
  assert.equal(maxActive, 2);
});

test("the shared photo route rejects a body beyond its byte limit even without Content-Length", async () => {
  const service = sharedPhotoService();
  const originalFetch = globalThis.fetch;
  let cancelled = false;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { controller.enqueue(new Uint8Array(7 * 1024 * 1024)); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "image/heic" } });
  try {
    await assert.rejects(service.downloadMessageAttachment("message", 0), { status: 400 });
    assert.equal(cancelled, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the shared photo route cancels bodies before rejecting by status, size or media header", async () => {
  const service = sharedPhotoService();
  const originalFetch = globalThis.fetch;
  try {
    for (const [status, headers, expected] of [
      [404, {}, 502],
      [200, { "content-type": "image/heic", "content-length": "13000000" }, 400],
      [200, { "content-type": "text/html" }, 502],
    ]) {
      let cancelled = false;
      globalThis.fetch = async () => new Response(new ReadableStream({
        cancel() { cancelled = true; },
      }), { status, headers });
      await assert.rejects(service.downloadMessageAttachment("message", 0), { status: expected });
      assert.equal(cancelled, true, `upstream response body was left open for ${status} ${JSON.stringify(headers)}`);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stalled body cancellations stop at the shared deadline and release the download slots", { timeout: 3000 }, async () => {
  const service = sharedPhotoService();
  const originalFetch = globalThis.fetch, originalTimeout = AbortSignal.timeout;
  try {
    for (const [status, headers, overflow, expected] of [
      [302, { location: "/next" }, false, 502],
      [404, {}, false, 502],
      [200, { "content-type": "image/heic" }, true, 400],
    ]) {
      const deadline = new AbortController();
      let fetches = 0, cancellations = 0;
      AbortSignal.timeout = milliseconds => {
        assert.equal(milliseconds, 12_000);
        return deadline.signal;
      };
      globalThis.fetch = async (url, { signal }) => {
        assert.equal(String(url), photoUrl);
        assert.equal(signal, deadline.signal);
        fetches++;
        return new Response(new ReadableStream({
          pull(controller) {
            if (overflow) controller.enqueue(new Uint8Array(7 * 1024 * 1024));
          },
          cancel() {
            cancellations++;
            if (cancellations === 2) deadline.abort();
            return new Promise(() => {});
          },
        }), { status, headers });
      };
      const requests = [service.downloadMessageAttachment("message", 0), service.downloadMessageAttachment("message", 0)];
      await Promise.all(requests.map(request => assert.rejects(request, { status: expected })));
      assert.equal(fetches, 2);
      assert.equal(cancellations, 2);
    }
    const jpeg = Buffer.from([255, 216, 255, 217]);
    globalThis.fetch = async () => new Response(jpeg, { headers: { "content-type": "image/heic" } });
    AbortSignal.timeout = originalTimeout;
    assert.deepEqual((await service.downloadMessageAttachment("message", 0)).body, jpeg);
  } finally {
    globalThis.fetch = originalFetch;
    AbortSignal.timeout = originalTimeout;
  }
});
