import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../public/crm-sw.js", import.meta.url), "utf8");
const origin = "https://crm.example";

function worker(cacheControl = "public, max-age=31536000, immutable") {
  const handlers = new Map();
  const saved = new Map();
  let fetchCount = 0;
  runInNewContext(source, {
    URL,
    importScripts(path) { assert.equal(path, "/crm-pwa-release.js"); },
    self: { location: { origin }, addEventListener: handlers.set.bind(handlers) },
    caches: {
      open: async () => ({
        match: async request => saved.get(request.url),
        put: async (request, response) => saved.set(request.url, response),
        keys: async () => [...saved.keys()],
      }),
    },
    fetch: async (request, options) => {
      assert.equal(options.credentials, "omit");
      assert.equal(options.redirect, "error");
      fetchCount += 1;
      const response = {
        status: 200,
        url: request.url,
        headers: new Headers({ "cache-control": cacheControl, "content-type": "application/javascript" }),
        clone: () => response,
      };
      return response;
    },
  });
  return {
    saved,
    count: () => fetchCount,
    request(path, destination = "script", method = "GET") {
      let result;
      const request = { url: new URL(path, origin).href, method, destination, headers: new Headers() };
      handlers.get("fetch")({ request, respondWith: response => { result = response; } });
      return result;
    },
  };
}

test("only fingerprinted public assets can be served from Cache Storage", async () => {
  const w = worker();
  const asset = "/_next/static/chunks/3b91fcd21.js";
  await w.request(asset);
  await w.request(asset);
  assert.equal(w.count(), 1);
  assert.equal(w.saved.size, 1);
  await w.request("/_next/static/chunks/0b6-sngaga7jh.js");
  assert.equal(w.saved.size, 2);
  for (const path of [
    "/", "/?section=orders", "/parent-measurements/token",
    "/api/auth/me", "/api/orders/123.js", "/uploads/3b91fcd21.js",
    "/backup-sync/3b91fcd21.js", "/_next/image?url=/api/private",
    "/_next/static/chunks/unversioned.js", asset + "?private=1",
    "https://another.example" + asset,
  ]) assert.equal(w.request(path), undefined, path);
  assert.equal(w.request(asset, "document"), undefined);
  assert.equal(w.request(asset, "script", "POST"), undefined);
});

test("a response marked private or no-store cannot enter Cache Storage", async () => {
  for (const policy of ["private", "public, immutable, no-store", "public"]) {
    const w = worker(policy);
    await w.request("/_next/static/chunks/3b91fcd21.js");
    assert.equal(w.saved.size, 0, policy);
  }
});
