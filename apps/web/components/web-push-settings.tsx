"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Group, Stack, Switch, Text, Title } from "@mantine/core";
import { webPushUi as ui } from "../lib/i18n";

type Topics = { messages: boolean; websiteOrders: boolean };
type PushConfig = {
  enabled: boolean;
  publicKey: string | null;
  subscription: { topics: Topics } | null;
};
const OFF: Topics = { messages: false, websiteOrders: false };

async function activeWorkerSupportsPush(registration?: ServiceWorkerRegistration): Promise<boolean> {
  return new Promise(resolve => {
    const channel = new MessageChannel();
    let finished = false;
    const finish = (ready: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      channel.port1.close();
      channel.port2.close();
      resolve(ready);
    };
    const timer = setTimeout(() => finish(false), 1500);
    channel.port1.onmessage = event => finish(event.data?.type === "CRM_PUSH_READY" && event.data.version === 1);
    void Promise.resolve().then(() => registration ?? navigator.serviceWorker.getRegistration("/")).then(current => {
      if (finished) return;
      if (!current?.active) return finish(false);
      current.active.postMessage({ type: "CRM_PUSH_READINESS" }, [channel.port2]);
    }).catch(() => finish(false));
  });
}

async function deleteSubscription(endpoint: string, signal = AbortSignal.timeout(5000)) {
  const response = await fetch("/api/web-push/subscriptions", {
    method: "DELETE",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
    signal,
  });
  if (!response.ok) throw new Error(ui.disableError);
}

// Session-bound backend subscriptions stop delivery on logout even if either
// best-effort device cleanup fails. Never prevent the user from ending a session.
export async function revokeWebPushDevice() {
  if (!("serviceWorker" in navigator)) return;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>(resolve => {
    timer = setTimeout(() => { controller.abort(); resolve(); }, 2000);
  });
  const cleanup = (async () => {
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      if (controller.signal.aborted) return;
      const subscription = await registration?.pushManager?.getSubscription();
      if (!subscription || controller.signal.aborted) return;
      try {
        await deleteSubscription(subscription.endpoint, controller.signal);
      } finally {
        if (!controller.signal.aborted) await subscription.unsubscribe();
      }
    } catch {
      // The backend independently checks that the owning Session remains active.
    }
  })();
  try {
    await Promise.race([cleanup, deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export function WebPushSettings() {
  const [support, setSupport] = useState<"loading" | "supported" | "ios" | "unsupported">("loading");
  const [config, setConfig] = useState<PushConfig>();
  const [topics, setTopics] = useState<Topics>(OFF);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [permission, setPermission] = useState<NotificationPermission>("default");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [workerReady, setWorkerReady] = useState<boolean | null>(null);
  const loadSequence = useRef(0);

  async function load() {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError("");
    try {
      const registration = await navigator.serviceWorker.getRegistration("/");
      const current = await registration?.pushManager.getSubscription() ?? null;
      const response = await fetch(current ? "/api/web-push/subscriptions/current" : "/api/web-push/config", {
        method: current ? "POST" : "GET",
        credentials: "include",
        cache: "no-store",
        ...(current ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ endpoint: current.endpoint }) } : {}),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(ui.loadError);
      const result: PushConfig = await response.json();
      const ready = current ? await activeWorkerSupportsPush(registration) : null;
      if (sequence !== loadSequence.current) return;
      setConfig(result);
      setWorkerReady(ready);
      setSubscription(current);
      setTopics(result.subscription?.topics ?? OFF);
      setPermission(Notification.permission);
    } catch {
      if (sequence !== loadSequence.current) return;
      setConfig(undefined);
      setError(ui.loadError);
    } finally {
      if (sequence === loadSequence.current) setLoading(false);
    }
  }

  useEffect(() => {
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone;
    if (ios && !standalone) {
      setSupport("ios");
      setLoading(false);
      return;
    }
    if (!window.isSecureContext || !window.PushManager || !window.Notification || !("serviceWorker" in navigator)) {
      setSupport("unsupported");
      setLoading(false);
      return;
    }
    setSupport("supported");
    void load();
    return () => { loadSequence.current++; };
  }, []);

  async function disable() {
    if (!subscription) return;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      // Remove server delivery first. A failed DELETE keeps retry information.
      await deleteSubscription(subscription.endpoint);
      const removed = await subscription.unsubscribe();
      if (!removed && await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription()) throw new Error(ui.disableError);
      setSubscription(null);
      setWorkerReady(null);
      setTopics(OFF);
      setSaved(true);
    } catch {
      setError(ui.disableError);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!topics.messages && !topics.websiteOrders) {
      await disable();
      return;
    }
    if (!config?.enabled || !config.publicKey) return;
    setBusy(true);
    setError("");
    setSaved(false);
    let created: PushSubscription | null = null;
    try {
      // Called directly from this button's click, before any network/worker await.
      const granted = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
      setPermission(granted);
      if (granted !== "granted") {
        if (granted === "default") setError(ui.permissionRequired);
        return;
      }
      let current = subscription;
      if (!current) {
        const registration = await navigator.serviceWorker.register("/crm-sw.js", { updateViaCache: "none" });
        if (!registration.active) {
          await new Promise<void>((resolve, reject) => {
            const timer = window.setTimeout(() => reject(new Error(ui.saveError)), 10000);
            void navigator.serviceWorker.ready.then(() => { clearTimeout(timer); resolve(); }, reject);
          });
        }
        const key = config.publicKey.replaceAll("-", "+").replaceAll("_", "/");
        const applicationServerKey = Uint8Array.from(atob(key), char => char.charCodeAt(0));
        current = await registration.pushManager.getSubscription();
        if (!current) {
          current = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
          created = current;
        }
      }
      const encoded = current.toJSON();
      if (!encoded.keys?.p256dh || !encoded.keys.auth) throw new Error(ui.saveError);
      const response = await fetch("/api/web-push/subscriptions", {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: current.endpoint, keys: encoded.keys, topics }),
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error(ui.saveError);
      setSubscription(current);
      setSaved(true);
      void activeWorkerSupportsPush().then(setWorkerReady).catch(() => setWorkerReady(false));
    } catch {
      // A subscription whose opt-in was not acknowledged must not remain active.
      if (created) await created.unsubscribe().catch(() => false);
      setError(ui.saveError);
    } finally {
      setBusy(false);
    }
  }

  const unavailable = loading || busy || !config?.enabled || !config.publicKey || permission === "denied";
  return <section id="settings-notifications-panel" role="tabpanel" aria-labelledby="settings-notifications-tab" className="settings-card">
    <Stack gap="md">
      <Title order={2}>{ui.title}</Title>
      <Text size="sm">{ui.hint}</Text>
      {support === "ios" && <Alert>{ui.ios}</Alert>}
      {support === "unsupported" && <Alert>{ui.unsupported}</Alert>}
      {support === "supported" && <>
        {loading && <Text role="status">{ui.loading}</Text>}
        {config && !config.enabled && <Alert>{ui.unavailable}</Alert>}
        {permission === "denied" && <Alert>{ui.denied}</Alert>}
        {workerReady === false && <Alert color="yellow" role="alert">
          <Text size="sm">{ui.workerUpdate}</Text>
          <Button type="button" variant="subtle" disabled={busy || loading} onClick={() => void load()}>{ui.retry}</Button>
        </Alert>}
        <Switch label={ui.messages} checked={topics.messages} disabled={unavailable} onChange={event => { const checked = event.currentTarget.checked; setTopics(current => ({ ...current, messages: checked })); setSaved(false); }}/>
        <Switch label={ui.websiteOrders} checked={topics.websiteOrders} disabled={unavailable} onChange={event => { const checked = event.currentTarget.checked; setTopics(current => ({ ...current, websiteOrders: checked })); setSaved(false); }}/>
        <Group>
          <Button type="button" loading={busy} disabled={unavailable || (!subscription && !topics.messages && !topics.websiteOrders)} onClick={() => void save()}>{ui.save}</Button>
          {subscription && <Button type="button" variant="default" disabled={busy} onClick={() => void disable()}>{ui.disable}</Button>}
          {!config && !loading && <Button type="button" variant="default" disabled={busy} onClick={() => void load()}>{ui.retry}</Button>}
        </Group>
      </>}
      {error && <Alert color="red" role="alert">{error}</Alert>}
      {saved && <Text role="status">{ui.saved}</Text>}
    </Stack>
  </section>;
}
