import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";

async function backendPushRoutes() {
  const require = createRequire(import.meta.url);
  const ts = require("typescript");
  const source = await readFile(new URL("../../api/src/web-push/web-push.controller.ts", import.meta.url), "utf8");
  const file = ts.createSourceFile("web-push.controller.ts", source, ts.ScriptTarget.Latest, true);
  const routes = new Set();
  for (const node of file.statements) {
    if (!ts.isClassDeclaration(node)) continue;
    const decorators = ts.getDecorators(node) ?? [];
    const controller = decorators.find(item => ts.isCallExpression(item.expression) && item.expression.expression.getText(file) === "Controller");
    if (!controller) continue;
    const prefix = controller.expression.arguments[0].text;
    for (const method of node.members) {
      for (const decorator of ts.getDecorators(method) ?? []) {
        const expression = decorator.expression;
        if (!ts.isCallExpression(expression)) continue;
        const verb = expression.expression.getText(file).toUpperCase();
        if (!["GET", "POST", "PUT", "DELETE"].includes(verb)) continue;
        routes.add(`${verb} /api/${prefix}/${expression.arguments[0].text}`);
      }
    }
  }
  return routes;
}

test("backend declares the same device-config and subscription routes used by the frontend", async () => {
  const routes = await backendPushRoutes();
  for (const route of ["GET /api/web-push/config", "POST /api/web-push/subscriptions/current", "PUT /api/web-push/subscriptions", "DELETE /api/web-push/subscriptions"]) {
    assert.ok(routes.has(route), `Backend is missing ${route}`);
  }
  assert.equal(routes.has("POST /api/web-push/config"), false, "the abandoned config POST route must not mask contract drift");
});

test("web push settings require a click, persist device topics, handle denial and revoke safely", { skip: process.env.YO_WEB_PUSH_BROWSER !== "1", timeout: 180000 }, async t => {
  const require = createRequire(import.meta.url);
  const { chromium, expect } = require("@playwright/test");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const web = resolve(root, "apps/web");
  const out = resolve(root, ".local/web-push-browser");
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText`);
  await writeFile(resolve(out, "entry.tsx"), `import React from 'react';import {createRoot} from 'react-dom/client';import {MantineProvider} from '@mantine/core';import {yoleotardTheme} from '${resolve(web, "lib/mantine-theme").replaceAll("\\", "/")}';import {WebPushSettings,revokeWebPushDevice} from '${resolve(web, "components/web-push-settings").replaceAll("\\", "/")}';window.revokeWebPushDevice=revokeWebPushDevice;createRoot(document.getElementById('app')).render(<React.StrictMode><MantineProvider theme={yoleotardTheme}><WebPushSettings/></MantineProvider></React.StrictMode>);`);
  const webpack = require("next/dist/compiled/webpack/webpack").webpack;
  await new Promise((ok, fail) => webpack({ mode: "development", devtool: false, entry: resolve(out, "entry.tsx"), output: { path: out, filename: "bundle.js" }, resolve: { extensions: [".tsx", ".ts", ".js"], modules: [resolve(web, "node_modules"), "node_modules"] }, module: { rules: [{ test: /\.tsx?$/, use: resolve(out, "loader.cjs") }] } }, (error, stats) => error || stats.hasErrors() ? fail(error ?? Error(stats.toString({ all: false, errors: true }))) : ok()));
  const css = Buffer.concat(await Promise.all([
    readFile(require.resolve("@mantine/core/styles.css")),
    readFile(resolve(web, "app/styles.css")),
    readFile(resolve(web, "app/mantine-overrides.css")),
  ]));
  const requests = [];
  const backendRoutes = await backendPushRoutes();
  const errors = [];
  let topics = null;
  let failPut = false;
  let failDelete = false;
  let failConfig = false;
  let hangDelete = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname.startsWith("/api/web-push/")) {
      assert.ok(backendRoutes.has(`${req.method} ${url.pathname}`), `Actual frontend request has no backend controller route: ${req.method} ${url.pathname}`);
      assert.equal(url.search, "", "push endpoints must never enter query strings");
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : undefined;
    const json = (data, status = 200) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(data)); };
    if (["/api/web-push/config", "/api/web-push/subscriptions/current"].includes(url.pathname)) {
      if (failConfig) return json({}, 503);
      assert.equal(url.search, "", "push endpoint must never enter a URL");
      requests.push({ method: req.method, config: true, endpoint: body?.endpoint });
      return json({ enabled: true, publicKey: Buffer.alloc(65, 4).toString("base64url"), subscription: topics && body?.endpoint ? { topics } : null });
    }
    if (url.pathname === "/api/web-push/subscriptions") {
      requests.push({ method: req.method, body });
      if (req.method === "DELETE" && hangDelete) return;
      if ((req.method === "PUT" && failPut) || (req.method === "DELETE" && failDelete)) return json({}, 503);
      topics = req.method === "PUT" ? body.topics : null;
      return json({ ok: true });
    }
    if (url.pathname === "/api/auth/logout") { requests.push({ method: "LOGOUT" }); return json({ ok: true }); }
    if (url.pathname === "/bundle.js") { res.writeHead(200, { "content-type": "text/javascript" }); return res.end(await readFile(resolve(out, "bundle.js"))); }
    if (url.pathname === "/styles.css") { res.writeHead(200, { "content-type": "text/css" }); return res.end(css); }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end('<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"><body><main id="app"></main><script src="/bundle.js"></script></body></html>');
  });
  await new Promise(ok => server.listen(0, "127.0.0.1", ok));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.permissionRequests = 0;
    window.unsubscribeCalls = 0;
    const params = new URLSearchParams(location.search);
    let permission = params.get("permission") || "default";
    const subscription = { endpoint: "https://fcm.googleapis.com/fcm/send/test-device", toJSON: () => ({ endpoint: subscription.endpoint, keys: { p256dh: "device-public-key", auth: "device-auth" } }), unsubscribe: async () => { window.unsubscribeCalls++; if (params.has("hangUnsubscribe")) return new Promise(() => {}); return true; } };
    let current = params.has("existing") ? subscription : null;
    const registration = { active: { scriptURL: location.origin + "/crm-sw.js", postMessage(message, ports) { if (!params.has("oldWorker") && message.type === "CRM_PUSH_READINESS") ports[0].postMessage({ type: "CRM_PUSH_READY", version: 1 }); } }, pushManager: { getSubscription: async () => params.has("hangSubscription") ? new Promise(() => {}) : current, subscribe: async options => { if (!options.userVisibleOnly) throw Error("Missing userVisibleOnly"); current = subscription; window.didSubscribe = true; return current; } } };
    Object.defineProperty(window, "Notification", { configurable: true, value: { get permission() { return permission; }, requestPermission: async () => { window.permissionRequests++; permission = params.get("answer") || "granted"; return permission; } } });
    Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: { getRegistration: async () => { if (window.didSubscribe && params.has("failPostSaveRegistration")) throw Error("Registration unavailable after acknowledged PUT"); if (window.didSubscribe && params.has("hangPostSaveRegistration")) return new Promise(() => {}); return params.has("hangRegistration") ? new Promise(resolve => { window.finishRegistration = () => resolve(registration); }) : registration; }, register: async () => registration, ready: Promise.resolve(registration) } });
    if (params.has("unsupported")) Object.defineProperty(window, "PushManager", { configurable: true, value: undefined });
    if (params.has("ios")) Object.defineProperty(navigator, "userAgent", { configurable: true, value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" });
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const messages = () => page.getByRole("switch", { name: "Новые сообщения", exact: true });
  const orders = () => page.getByRole("switch", { name: "Заказы с сайта", exact: true });
  const save = () => page.getByRole("button", { name: "Сохранить уведомления", exact: true });
  await page.goto(base);
  await expect(messages()).toBeEnabled();
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  const expectKeyboardFocus = async locator => {
    await expect(locator).toBeFocused();
    assert.equal(await locator.evaluate(element => element.matches(":focus-visible")), true);
    const visibleRing = await locator.evaluate(element => {
      const candidates = [element, ...element.parentElement.querySelectorAll("*")];
      return candidates.some(candidate => {
        const style = getComputedStyle(candidate);
        return style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0 && style.outlineColor !== "rgba(0, 0, 0, 0)";
      });
    });
    assert.equal(visibleRing, true, "keyboard focus must have a visible outline");
  };
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(messages());
  await page.keyboard.press("Space");
  await expect(messages()).toBeChecked();
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(orders());
  await page.keyboard.press("Space");
  await expect(orders()).toBeChecked();
  await page.keyboard.press("Space");
  await expect(orders()).not.toBeChecked();
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  await page.keyboard.press("Tab");
  await expectKeyboardFocus(save());
  await page.screenshot({ path: resolve(out, "keyboard-save-focus-390.png"), fullPage: true });
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Настройки уведомлений сохранены");
  assert.equal(await page.evaluate(() => window.permissionRequests), 1);
  assert.deepEqual(requests.find(request => request.method === "PUT").body.topics, { messages: true, websiteOrders: false });
  await page.goto(base + "/?existing&permission=granted");
  await expect(messages()).toBeChecked();
  await expect(orders()).not.toBeChecked();
  await orders().check();
  failPut = true;
  await save().click();
  await expect(page.getByRole("alert")).toContainText("Не удалось сохранить");
  failPut = false;
  await save().click();
  await expect(page.getByRole("status")).toContainText("Настройки уведомлений сохранены");
  assert.deepEqual(topics, { messages: true, websiteOrders: true });
  for (const width of [320, 390, 1366, 1920]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: resolve(out, `settings-${width}.png`), fullPage: true });
  }
  failDelete = true;
  await page.getByRole("button", { name: "Отключить на этом устройстве", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Не удалось отключить");
  assert.equal(await page.evaluate(() => window.unsubscribeCalls), 0);
  failDelete = false;
  await page.getByRole("button", { name: "Отключить на этом устройстве", exact: true }).click();
  await expect(messages()).not.toBeChecked();
  assert.equal(await page.evaluate(() => window.unsubscribeCalls), 1);
  await page.goto(base + "/?answer=denied");
  await expect(messages()).toBeEnabled();
  await messages().check();
  await save().click();
  await expect(page.getByText("Разрешите уведомления в настройках браузера.", { exact: true })).toBeVisible();
  await expect(save()).toBeDisabled();
  await page.goto(base + "/?unsupported");
  await expect(page.getByText("Этот браузер не поддерживает push-уведомления.", { exact: true })).toBeVisible();
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  await page.goto(base + "/?ios");
  await expect(page.getByText(/На iPhone и iPad откройте CRM в Safari/)).toBeVisible();
  await expect(save()).toHaveCount(0);
  assert.equal(await page.evaluate(() => window.permissionRequests), 0);
  failConfig = true;
  await page.goto(base);
  await expect(page.getByRole("alert")).toContainText("Не удалось загрузить");
  failConfig = false;
  await page.getByRole("button", { name: "Повторить загрузку", exact: true }).click();
  await expect(messages()).toBeEnabled();
  failPut = true;
  await messages().check();
  await save().click();
  await expect(page.getByRole("alert")).toContainText("Не удалось сохранить");
  assert.equal(await page.evaluate(() => window.unsubscribeCalls), 1, "unacknowledged new subscription is removed");
  failPut = false;
  await page.goto(base + "/?existing&permission=granted");
  await expect(messages()).toBeEnabled();
  failDelete = true;
  await page.evaluate(() => window.revokeWebPushDevice());
  assert.equal(await page.evaluate(() => window.unsubscribeCalls), 1, "logout still unsubscribes when API deletion fails");
  failDelete = false;
  for (const blocked of ["hangRegistration", "hangSubscription", "hangUnsubscribe", "hangDelete"]) {
    hangDelete = blocked === "hangDelete";
    await page.goto(base + "/?existing&permission=granted&" + blocked);
    await expect(page.getByRole("heading", { name: "Уведомления на устройстве" })).toBeVisible();
    const result = await page.evaluate(async () => {
      const start = performance.now();
      await window.revokeWebPushDevice();
      const response = await fetch("/api/auth/logout", { method: "POST" });
      return { ok: response.ok, elapsed: performance.now() - start };
    });
    assert.equal(result.ok, true, `${blocked} must not prevent logout`);
    assert.ok(result.elapsed < 3500, `${blocked} cleanup took ${result.elapsed}ms`);
    if (blocked === "hangRegistration") {
      const deletes = requests.filter(request => request.method === "DELETE").length;
      await page.evaluate(() => window.finishRegistration());
      await page.waitForTimeout(50);
      assert.equal(await page.evaluate(() => window.unsubscribeCalls), 0, "late registration must not unsubscribe a later session");
      assert.equal(requests.filter(request => request.method === "DELETE").length, deletes);
    }
  }
  for (const failure of ["failPostSaveRegistration", "hangPostSaveRegistration"]) {
    await page.goto(base + "/?" + failure);
    await expect(messages()).toBeEnabled();
    await messages().check();
    await save().click();
    await expect(page.getByRole("status")).toContainText("Настройки уведомлений сохранены");
    await expect(save()).toBeEnabled();
    await expect(page.getByRole("alert")).toContainText("Не удалось подтвердить готовность приложения");
    assert.equal(await page.evaluate(() => window.unsubscribeCalls), 0, "failed readiness must preserve acknowledged consent");
  }
  hangDelete = false;
  await page.goto(base + "/?existing&permission=granted&oldWorker");
  await expect(page.getByRole("alert")).toContainText("Не удалось подтвердить готовность приложения");
  assert.equal(await page.evaluate(() => window.permissionRequests), 0, "readiness check must not request permission");
  assert.equal(await page.evaluate(() => window.unsubscribeCalls), 0, "readiness check must preserve device consent");
  await page.goto(base + "/?existing&permission=granted");
  await expect(messages()).toBeEnabled();
  await expect(page.getByText(/Не удалось подтвердить готовность приложения/)).toHaveCount(0);
  assert.deepEqual(errors, []);
});
