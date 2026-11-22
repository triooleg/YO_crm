import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { webPushUi } from "../lib/i18n";

test("the next worker waits for all CRM windows and caches only public assets", async ({ context }) => {
  const worker = readFileSync(join(process.cwd(), "public/crm-sw.js"));
  const assetPath = "/_next/static/chunks/074kgvwfbiujh.js";
  let release = 1;
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.url === "/crm-sw.js" || request.url === "/crm-pwa-release.js") {
      response.setHeader("Content-Type", "text/javascript");
      return response.end(request.url === "/crm-sw.js" ? worker : `/* release ${release} */ self.crmPushUi = ${JSON.stringify({ notificationTitle: webPushUi.notificationTitle, notificationMessage: webPushUi.notificationMessage, notificationWebsiteOrder: webPushUi.notificationWebsiteOrder })};`);
    }
    if (request.url === assetPath) {
      response.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      response.setHeader("Content-Type", "text/javascript");
      return response.end("window.assetLoaded = true;");
    }
    if (request.url === "/api/orders") return response.end("private data");
    if (request.url === "/observe") return response.end("lifecycle observer");
    response.setHeader("Content-Type", "text/html");
    response.end(`<input id="draft"><script src="${assetPath}"></script>`);
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const first = await context.newPage();
    await first.goto(origin + "/crm/");
    await first.evaluate(async () => {
      await navigator.serviceWorker.register("/crm-sw.js", { scope: "/crm/", updateViaCache: "none" });
      await navigator.serviceWorker.ready;
    });
    await first.reload();
    await expect.poll(() => first.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    const pushReady = await first.evaluate(async () => {
      const registration = await navigator.serviceWorker.ready;
      return new Promise<boolean>(resolve => {
        const channel = new MessageChannel();
        const timer = setTimeout(() => { channel.port1.close(); resolve(false); }, 2000);
        channel.port1.onmessage = event => {
          clearTimeout(timer);
          channel.port1.close();
          resolve(event.data?.type === "CRM_PUSH_READY" && event.data.version === 1);
        };
        registration.active!.postMessage({ type: "CRM_PUSH_READINESS" }, [channel.port2]);
      });
    });
    expect(pushReady).toBe(true);
    const second = await context.newPage();
    await second.goto(origin + "/crm/");
    await first.locator("#draft").fill("Несохранённый текст");
    await first.evaluate(() => fetch("/api/orders").then(response => response.text()));
    const cachedPaths = await first.evaluate(async () => {
      const keys = await caches.keys();
      const requests = await Promise.all(keys.map(async key => (await caches.open(key)).keys()));
      return requests.flat().map(request => new URL(request.url).pathname);
    });
    expect(cachedPaths).toEqual([assetPath]);

    release = 2;
    await first.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
    await expect.poll(() => second.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
    await expect(first.locator("#draft")).toHaveValue("Несохранённый текст");
    await second.close();
    await expect.poll(() => first.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);

    const observer = await context.newPage();
    await observer.goto(origin + "/observe");
    await expect.poll(() => observer.evaluate(async () => !!(await navigator.serviceWorker.getRegistration("/crm/"))?.waiting)).toBe(true);
    await first.close();
    await expect.poll(() => observer.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration("/crm/");
      return !!registration && !registration.waiting && registration.active?.state === "activated";
    })).toBe(true);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
