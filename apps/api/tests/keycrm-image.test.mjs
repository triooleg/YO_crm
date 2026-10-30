import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { PassThrough } from "node:stream";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);

function loadModule() {
  const source = readFileSync(new URL("../src/keycrm/keycrm-image.ts", import.meta.url), "utf8")
    .replace('import { uploadsRoot } from "../uploads";', 'const uploadsRoot = () => process.cwd();');
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const module = { exports: {} };
  const targetRequire = (name) => {
    if (name !== '../recovery-safety') return require(name);
    const helper = { exports: {} };
    const code = ts.transpileModule(readFileSync(new URL('../src/recovery-safety.ts', import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('module', 'exports', code)(helper, helper.exports);
    return helper.exports;
  };
  new Function("require", "module", "exports", output)(targetRequire, module, module.exports);
  return module.exports;
}

const publicLookup = async () => [{ address: "93.184.216.34", family: 4 }];

test("KeyCRM image is validated, normalized and stored under a deterministic local name", async () => {
  const { materializeKeycrmOrderImage, removeMaterializedKeycrmOrderImage } = loadModule();
  const root = await mkdtemp(join(tmpdir(), "keycrm-image-"));
  const png = await sharp({ create: { width: 4, height: 4, channels: 4, background: "red" } }).png().toBuffer();
  let requests = 0;
  const fetchFn = async () => { requests++; return new Response(png, { headers: { "content-type": "image/png", "content-length": String(png.length) } }); };
  const first = await materializeKeycrmOrderImage("https://cdn.example.test/order.png", { root, fetchFn, lookupFn: publicLookup });
  const second = await materializeKeycrmOrderImage("https://cdn.example.test/order.png", { root, fetchFn, lookupFn: publicLookup });
  assert.equal(first, second);
  assert.match(first, /^keycrm-[a-f0-9]{32}\.jpg$/);
  assert.equal((await sharp(await readFile(join(root, "order-models", first))).metadata()).format, "jpeg");
  assert.equal(requests, 2);
  assert.equal(await removeMaterializedKeycrmOrderImage(first, { root }), true);
  await assert.rejects(() => readFile(join(root, "order-models", first)), /ENOENT/);
  assert.equal(await removeMaterializedKeycrmOrderImage(first, { root }), false);
});

test("KeyCRM image cache follows content changes at the same URL and rejects extreme dimensions", async () => {
  const { materializeKeycrmOrderImage } = loadModule();
  const root = await mkdtemp(join(tmpdir(), "keycrm-image-"));
  const red = await sharp({ create: { width: 4, height: 4, channels: 3, background: "red" } }).png().toBuffer();
  const blue = await sharp({ create: { width: 4, height: 4, channels: 3, background: "blue" } }).png().toBuffer();
  let body = red;
  const fetchFn = async () => new Response(body, { headers: { "content-type": "image/png", "content-length": String(body.length) } });
  const first = await materializeKeycrmOrderImage("https://cdn.example.test/order.png", { root, fetchFn, lookupFn: publicLookup });
  body = blue;
  const second = await materializeKeycrmOrderImage("https://cdn.example.test/order.png", { root, fetchFn, lookupFn: publicLookup });
  assert.notEqual(first, second);
  const tooWide = await sharp({ create: { width: 12_001, height: 1, channels: 3, background: "white" } }).png().toBuffer();
  await assert.rejects(() => materializeKeycrmOrderImage("https://cdn.example.test/wide.png", { root, lookupFn: publicLookup, fetchFn: async () => new Response(tooWide, { headers: { "content-type": "image/png" } }) }), /PIXELS_REJECTED/);
});

test("KeyCRM image materialization rejects private hosts, non-images and oversized bodies", async () => {
  const { materializeKeycrmOrderImage } = loadModule();
  const root = await mkdtemp(join(tmpdir(), "keycrm-image-"));
  for (const address of ["127.0.0.1", "169.254.1.1", "100.64.0.1", "192.0.2.1", "::1", "fc00::1", "febf::1", "2001:db8::1", "::ffff:172.20.1.2"]) {
    await assert.rejects(() => materializeKeycrmOrderImage("https://internal.test/a.jpg", { root, lookupFn: async () => [{ address, family: address.includes(":") ? 6 : 4 }] }), /HOST_REJECTED/);
  }
  await assert.rejects(() => materializeKeycrmOrderImage("https://cdn.example.test/a.jpg", { root, lookupFn: publicLookup, fetchFn: async () => new Response("html", { headers: { "content-type": "text/html" } }) }), /TYPE_REJECTED/);
  await assert.rejects(() => materializeKeycrmOrderImage("https://cdn.example.test/a.jpg", { root, lookupFn: publicLookup, fetchFn: async () => new Response("x", { headers: { "content-type": "image/jpeg", "content-length": String(9 * 1024 * 1024) } }) }), /TOO_LARGE/);
});

test("production HTTPS path pins the validated DNS address and preserves hostname for TLS", async () => {
  const { materializeKeycrmOrderImage } = loadModule();
  const root = await mkdtemp(join(tmpdir(), "keycrm-image-"));
  const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "green" } }).png().toBuffer();
  let requestOptions;
  const requestFn = (_url, options, callback) => {
    requestOptions = options;
    const response = new PassThrough();
    response.statusCode = 200;
    response.headers = { "content-type": "image/png", "content-length": String(png.length) };
    queueMicrotask(() => { callback(response); response.end(png); });
    const request = { setTimeout: () => request, on: () => request, end: () => undefined, destroy: () => undefined };
    return request;
  };
  await materializeKeycrmOrderImage("https://cdn.example.test/order.png", { root, requestFn, lookupFn: publicLookup });
  assert.equal(requestOptions.servername, "cdn.example.test");
  await new Promise((resolve, reject) => requestOptions.lookup("cdn.example.test", {}, (error, address, family) => error ? reject(error) : (assert.deepEqual({ address, family }, { address: "93.184.216.34", family: 4 }), resolve())));
  await new Promise((resolve, reject) => requestOptions.lookup("cdn.example.test", { all: true }, (error, addresses) => error ? reject(error) : (assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]), resolve())));
});

test("KeyCRM APPLY persists the materialized main image without replacing a manual image", () => {
  const imageSource = readFileSync(new URL("../src/keycrm/keycrm-image.ts", import.meta.url), "utf8");
  const source = readFileSync(new URL("../src/keycrm/keycrm.service.ts", import.meta.url), "utf8");
  assert.match(imageSource, /_options\.all[\s\S]*callback\(null, \[resolved\]\)/);
  assert.match(imageSource, /servername: url\.hostname/);
  assert.match(imageSource, /downloadPinned\(new URL\(location, url\), lookupFn, requestFn, redirects \+ 1\)/);
  assert.match(source, /await materializeKeycrmOrderImage\(mainExternalImageUrl\)/);
  assert.match(source, /importedModelImagePath \? \{ modelImagePath: importedModelImagePath \}/);
  assert.match(source, /shouldReplaceImportedImage\(existing\.modelImagePath, importedModelImagePath\)/);
  assert.match(source, /shouldReplaceImportedImage\(beforeItem\?\.modelImagePath, localImage\)/);
  assert.match(source, /ORDER_IMAGE_IMPORT_FAILED/);
  assert.match(source, /cleanupImportedImage\(importedModelImagePath\)/);
  assert.match(source, /modelImagePath: \{ startsWith: "keycrm-" \}/);
});
