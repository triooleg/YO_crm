/* Only public, fingerprinted build assets may enter the CRM Cache Storage. */
importScripts("/crm-pwa-release.js");

const CACHE_PREFIX = "yoleotard-crm-static-";
const CACHE_NAME = CACHE_PREFIX + "1";
const MAX_ENTRIES = 120;
// Next can emit base-36-style Turbopack chunk names as well as hexadecimal hashes.
const BUILD_ASSET = /^\/_next\/static\/(?:[\w.-]+\/)*(?:[\w.-]*[0-9a-f]{8,}[\w.-]*|[0-9][a-z0-9_-]{12})\.(?:js|css|woff2?|ttf)$/i;
const STATIC_DESTINATIONS = new Set(["script", "style", "font"]);

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map(key => caches.delete(key)),
  )));
});

self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" || url.origin !== self.location.origin ||
    url.search || !STATIC_DESTINATIONS.has(request.destination) ||
    request.headers.has("range") || !BUILD_ASSET.test(url.pathname)
  ) return;

  event.respondWith(loadAsset(request));
});

async function loadAsset(request) {
  let cache;
  try {
    cache = await caches.open(CACHE_NAME);
    const saved = await cache.match(request);
    if (saved) return saved;
  } catch {
    // Storage can be unavailable in private browsing or under quota pressure.
  }

  const response = await fetch(request, { credentials: "omit", redirect: "error" });
  const policy = response.headers.get("cache-control") || "";
  const type = response.headers.get("content-type") || "";
  const validType = request.destination === "script" ? /javascript|ecmascript/i.test(type)
    : request.destination === "style" ? /^text\/css\b/i.test(type)
    : /^(?:font\/|application\/(?:font|x-font|octet-stream))/i.test(type);
  if (
    cache && response.status === 200 && response.url === request.url && validType &&
    /\bpublic\b/i.test(policy) && /\bimmutable\b/i.test(policy) &&
    !/\b(?:private|no-store|no-cache)\b/i.test(policy) &&
    !/(?:cookie|authorization|\*)/i.test(response.headers.get("vary") || "")
  ) {
    try {
      await cache.put(request, response.clone());
      const keys = await cache.keys();
      await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES)).map(key => cache.delete(key)));
    } catch {
      // A failed cache write must not fail a successful network request.
    }
  }
  return response;
}

// Payload text is untrusted. Keep notification copy public and fixed.
// The imported release script supplies public copy from the central UI dictionary.
const PUSH_ROUTES = new Set(["/?section=inbox", "/?section=orders"]);

self.addEventListener("message", event => {
  if (event.data?.type === "CRM_PUSH_READINESS" && event.ports?.[0]) {
    event.ports[0].postMessage({ type: "CRM_PUSH_READY", version: 1 });
  }
});

self.addEventListener("push", event => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    return;
  }
  if (!payload || !["messages", "websiteOrders"].includes(payload.topic)) return;
  const messages = payload.topic === "messages";
  // Store only a canonical public route in the notification, never the payload.
  const url = messages ? "/?section=inbox" : "/?section=orders";
  const tag = typeof payload.tag === "string" && /^crm-push-[a-zA-Z0-9_-]{1,100}$/.test(payload.tag) ? payload.tag : undefined;
  event.waitUntil(self.registration.showNotification(self.crmPushUi.notificationTitle, {
    body: messages ? self.crmPushUi.notificationMessage : self.crmPushUi.notificationWebsiteOrder,
    icon: "/meta/crm-pwa-192.png",
    badge: "/meta/crm-pwa-192.png",
    data: { url },
    ...(tag ? { tag } : {}),
    renotify: false,
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  const route = event.notification.data?.url;
  if (!PUSH_ROUTES.has(route)) return;
  const url = new URL(route, self.location.origin);
  if (url.origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const crmWindows = windows.map(client => ({ client, url: new URL(client.url) }))
      .filter(window => window.url.origin === self.location.origin && window.url.pathname === "/");
    const section = url.searchParams.get("section");
    const existing = crmWindows.find(window => window.url.searchParams.get("section") === section) ?? crmWindows[0];
    // Android may reuse a standalone window for openWindow. Focus any existing
    // root CRM window without navigating so unsaved edits remain intact.
    if (existing) await existing.client.focus();
    else await self.clients.openWindow(url.href);
  })());
});
