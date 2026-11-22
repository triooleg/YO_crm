"use client";

import { Alert, Button, Group, Modal, Stack, Text } from "@mantine/core";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { pwaUi } from "../lib/i18n";

const DISMISSED_KEY = "yoleotard-crm-install-dismissed";
const INSTALLED_KEY = "yoleotard-crm-installed";

interface InstallEvent extends Event {
  prompt(): Promise<unknown>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function readFlag(key: string) {
  try { return localStorage.getItem(key) === "1"; } catch { return false; }
}

function writeFlag(key: string) {
  try { localStorage.setItem(key, "1"); } catch { /* Storage is optional. */ }
}

const PwaContext = createContext({
  installed: false,
  standalone: false,
  offer: false,
  updateWaiting: false,
  install: () => {},
  dismiss: () => {},
  instructions: false,
  closeInstructions: () => {},
  ios: false,
});

export function CrmPwaProvider({ children }: { children: ReactNode }) {
  const [prompt, setPrompt] = useState<InstallEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [standalone, setStandalone] = useState(false);
  const [dismissed, setDismissed] = useState(true);
  const [instructions, setInstructions] = useState(false);
  const [updateWaiting, setUpdateWaiting] = useState(false);

  useEffect(() => {
    const display = window.matchMedia("(display-mode: standalone)");
    const appleNavigator = navigator as Navigator & { standalone?: boolean };
    setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
    setDismissed(readFlag(DISMISSED_KEY));
    const checkDisplay = () => {
      const standalone = display.matches || appleNavigator.standalone === true;
      if (standalone) writeFlag(INSTALLED_KEY);
      setStandalone(standalone);
      setInstalled(standalone || readFlag(INSTALLED_KEY));
    };
    const capturePrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallEvent);
      // A fresh native offer also covers reinstall after uninstall.
      try { localStorage.removeItem(INSTALLED_KEY); } catch { /* Storage is optional. */ }
      setInstalled(display.matches || appleNavigator.standalone === true);
    };
    const confirmInstall = () => {
      writeFlag(INSTALLED_KEY);
      setInstalled(true);
      setPrompt(null);
      setInstructions(false);
    };
    const syncInstallFlags = (event: StorageEvent) => {
      if (event.key === null || event.key === DISMISSED_KEY) setDismissed(readFlag(DISMISSED_KEY));
      if (event.key === null || event.key === INSTALLED_KEY) checkDisplay();
    };

    checkDisplay();
    display.addEventListener("change", checkDisplay);
    window.addEventListener("beforeinstallprompt", capturePrompt);
    window.addEventListener("appinstalled", confirmInstall);
    window.addEventListener("storage", syncInstallFlags);
    let cleanupWorker: (() => void) | undefined;
    let disposed = false;
    if (process.env.NODE_ENV === "production" && window.isSecureContext && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/crm-sw.js", { updateViaCache: "none" }).then(registration => {
        if (disposed) return;
        const sync = () => setUpdateWaiting(Boolean(registration.waiting && navigator.serviceWorker.controller));
        let watchedWorker: ServiceWorker | null = null;
        const watch = () => {
          watchedWorker?.removeEventListener("statechange", sync);
          watchedWorker = registration.installing;
          watchedWorker?.addEventListener("statechange", sync);
          sync();
        };
        watch();
        let lastCheck = Date.now();
        const checkForUpdate = () => {
          if (document.visibilityState !== "visible" || Date.now() - lastCheck < 60_000) return;
          lastCheck = Date.now();
          void registration.update().catch(() => { /* Retry on a subsequent foreground visit. */ });
        };
        document.addEventListener("visibilitychange", checkForUpdate);
        window.addEventListener("focus", checkForUpdate);
        registration.addEventListener("updatefound", watch);
        navigator.serviceWorker.addEventListener("controllerchange", sync);
        cleanupWorker = () => {
          watchedWorker?.removeEventListener("statechange", sync);
          document.removeEventListener("visibilitychange", checkForUpdate);
          window.removeEventListener("focus", checkForUpdate);
          registration.removeEventListener("updatefound", watch);
          navigator.serviceWorker.removeEventListener("controllerchange", sync);
        };
      }).catch(() => { /* CRM remains usable without a service worker. */ });
    }

    return () => {
      disposed = true;
      cleanupWorker?.();
      display.removeEventListener("change", checkDisplay);
      window.removeEventListener("beforeinstallprompt", capturePrompt);
      window.removeEventListener("appinstalled", confirmInstall);
      window.removeEventListener("storage", syncInstallFlags);
    };
  }, []);

  function dismiss() {
    writeFlag(DISMISSED_KEY);
    setDismissed(true);
  }

  function install() {
    if (standalone) return;
    if (!prompt) {
      setInstructions(true);
      return;
    }
    const installRequest = prompt;
    setPrompt(null);
    void installRequest.prompt().then(() => installRequest.userChoice).then(({ outcome }) => {
      if (outcome === "dismissed") dismiss();
    }).catch(() => setInstructions(true));
  }

  return <PwaContext.Provider value={{
    installed, standalone, offer: !installed && !dismissed && (ios || !!prompt), updateWaiting, install, dismiss,
    instructions, closeInstructions: () => setInstructions(false), ios,
  }}>
    {children}
  </PwaContext.Provider>;
}

export function CrmPwaNotice({ settings = false }: { settings?: boolean }) {
  const { installed, standalone, offer, updateWaiting, install, dismiss, instructions, closeInstructions, ios } = useContext(PwaContext);
  if (!settings && !offer && !updateWaiting && !instructions) return null;

  return <>
    {!settings && <Modal opened={instructions && !standalone} onClose={closeInstructions} title={pwaUi.title} closeButtonProps={{ "aria-label": pwaUi.close }} centered>
      <Text size="sm">{ios ? pwaUi.ios : pwaUi.browser}</Text>
    </Modal>}
    {(settings || offer || updateWaiting) && <Stack className="crm-pwa-notice" gap="xs">
      {updateWaiting && !settings && <Alert role="status">{pwaUi.update}</Alert>}
      {(settings || offer) && <Alert title={pwaUi.title}>
        <Group gap="xs" justify="space-between">
          <Text size="sm">{standalone ? pwaUi.installed : installed ? pwaUi.previouslyInstalled : pwaUi.hint}</Text>
          {!standalone && <Group gap="xs">
            <Button size="compact-sm" onClick={install}>{installed ? pwaUi.instructions : pwaUi.install}</Button>
            {!settings && <Button size="compact-sm" variant="subtle" onClick={dismiss}>{pwaUi.later}</Button>}
          </Group>}
        </Group>
      </Alert>}
    </Stack>}
  </>;
}
