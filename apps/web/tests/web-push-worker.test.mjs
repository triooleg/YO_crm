import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

function loadTs(path, dependencies = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { module, exports: module.exports, require: name => dependencies[name], process, Response });
  return module.exports;
}
const dictionary = loadTs("../lib/i18n.ts");
const release = loadTs("../app/crm-pwa-release.js/route.ts", { "../../lib/i18n": dictionary });
const releaseScript = await release.GET().text();

const source = readFileSync(new URL("../public/crm-sw.js", import.meta.url), "utf8");

function worker(windows = []) {
  const handlers = new Map();
  const notifications = [];
  const opened = [];
  runInNewContext(source, {
    URL,
    importScripts(path) {
      assert.equal(path, "/crm-pwa-release.js");
      assert.match(releaseScript, /self\.crmPushUi =/);
    },
    caches: new Proxy({}, { get() { throw new Error("Push must never access Cache Storage"); } }),
    self: {
      crmPushUi: dictionary.webPushUi,
      location: { origin: "https://crm.example" },
      addEventListener: handlers.set.bind(handlers),
      registration: { showNotification: async (title, options) => notifications.push({ title, ...options }) },
      clients: { matchAll: async () => windows, openWindow: async url => opened.push(url) },
    },
  });
  return {
    notifications, opened,
    async push(payload) {
      let pending;
      handlers.get("push")({ data: { json: () => payload }, waitUntil: value => { pending = value; } });
      await pending;
    },
    async click(url) {
      let pending;
      handlers.get("notificationclick")({ notification: { data: { url }, close() {} }, waitUntil: value => { pending = value; } });
      await pending;
    },
  };
}

test("release script serializes only the central public notification copy", () => {
  const scope = {};
  runInNewContext(releaseScript, { self: scope });
  assert.deepEqual(JSON.parse(JSON.stringify(scope.crmPushUi)), {
    notificationTitle: dictionary.webPushUi.notificationTitle,
    notificationMessage: dictionary.webPushUi.notificationMessage,
    notificationWebsiteOrder: dictionary.webPushUi.notificationWebsiteOrder,
  });
});

test("push uses generic text, drops private payload and never touches Cache Storage", async () => {
  const w = worker();
  for (const topic of ["messages", "websiteOrders"]) {
    await w.push({ topic, url: topic === "messages" ? "/?section=inbox" : "/?section=orders", title: "Private client", body: "Private address", client: "Private name" });
  }
  assert.equal(w.notifications.length, 2);
  assert.doesNotMatch(JSON.stringify(w.notifications), /Private/);
  assert.equal(w.notifications[0].body, "Новое сообщение в CRM. Откройте приложение.");
  assert.equal(w.notifications[1].body, "Новый заказ с сайта. Откройте CRM.");
  assert.deepEqual(Object.keys(w.notifications[0].data), ["url"]);
});

test("notification clicks accept only canonical relative inbox and orders routes", async () => {
  const w = worker();
  for (const url of ["https://evil.example/", "https://crm.example/?section=inbox", "//evil.example", "/api/auth/logout", "/?section=settings", "/?section=inbox&url=https://evil.example", "/?section=orders#private", "javascript:alert(1)", "/\\evil.example"]) {
    await w.click(url);
  }
  assert.deepEqual(w.opened, []);
  await w.click("/?section=orders");
  assert.deepEqual(w.opened, ["https://crm.example/?section=orders"]);
});

test("notification click focuses an existing exact CRM destination", async () => {
  let focused = 0;
  const w = worker([{ url: "https://crm.example/?section=inbox", focus: async () => { focused++; } }]);
  await w.click("/?section=inbox");
  assert.equal(focused, 1);
  assert.deepEqual(w.opened, []);
});

test("notification click preserves a draft in another CRM section by focusing without opening or navigating", async () => {
  let focused = 0;
  const w = worker([{
    url: "https://crm.example/?section=orders&orderId=draft-order",
    focus: async () => { focused++; },
    navigate: async () => { assert.fail("An existing CRM window must never navigate"); },
  }]);
  await w.click("/?section=inbox");
  assert.equal(focused, 1);
  assert.deepEqual(w.opened, []);
});

test("notification click prioritizes the matching section with extra query parameters", async () => {
  const focused = [];
  const windows = [
    "https://other.example/?section=inbox",
    "https://crm.example/parent-measurements/token?section=inbox",
    "https://crm.example/?section=orders&orderId=draft-order",
    "https://crm.example/?section=inbox&clientId=draft-client#composer",
  ].map(url => ({
    url,
    focus: async () => focused.push(url),
    navigate: async () => { assert.fail("An existing CRM window must never navigate"); },
  }));
  const w = worker(windows);
  await w.click("/?section=inbox");
  assert.deepEqual(focused, [windows[3].url]);
  assert.deepEqual(w.opened, []);
});

test("notification click opens a window when only other origins or non-root pages exist", async () => {
  const w = worker(["https://other.example/", "https://crm.example/parent-measurements/token"].map(url => ({
    url,
    focus: async () => { assert.fail("Only same-origin root CRM windows may receive focus"); },
  })));
  await w.click("/?section=orders");
  assert.deepEqual(w.opened, ["https://crm.example/?section=orders"]);
});

test("a validated stable delivery tag collapses retries without re-alerting", async () => {
  const w = worker();
  const tag = "crm-push-31a01cc0d73c4ff6b7b6fd59f23a4cb2";
  await w.push({ topic: "messages", tag });
  await w.push({ topic: "messages", tag });
  assert.deepEqual(w.notifications.map(notification => notification.tag), [tag, tag]);
  assert.ok(w.notifications.every(notification => notification.renotify === false));
  for (const invalid of ["Private client name", "crm-push-", "crm-push-" + "x".repeat(101), "crm-push-user@example.com", {}, 123]) {
    await w.push({ topic: "messages", tag: invalid });
    assert.equal(Object.hasOwn(w.notifications.at(-1), "tag"), false);
  }
});

test("push readiness is answered only for the explicit protocol request", () => {
  const handlers = new Map();
  runInNewContext(source, { self: { addEventListener: handlers.set.bind(handlers) }, importScripts() {} });
  const answers = [];
  const port = { postMessage: value => answers.push(JSON.parse(JSON.stringify(value))) };
  handlers.get("message")({ data: { type: "OTHER" }, ports: [port] });
  handlers.get("message")({ data: { type: "CRM_PUSH_READINESS" }, ports: [] });
  assert.equal(answers.length, 0);
  handlers.get("message")({ data: { type: "CRM_PUSH_READINESS" }, ports: [port] });
  assert.deepEqual(answers, [{ type: "CRM_PUSH_READY", version: 1 }]);
});
