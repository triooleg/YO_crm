"use client";

import { useEffect, useState } from "react";

export type Branding = { logoUrl: string | null; useInHeader: boolean; useInMessages: boolean };
const fallback: Branding = { logoUrl: null, useInHeader: true, useInMessages: true };

export function useBranding(enabled = true) {
  const [branding, setBranding] = useState<Branding>(fallback);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const load = () => fetch("/api/branding", { credentials: "include" })
      .then(response => response.ok ? response.json() : Promise.reject())
      .then(value => { if (active) setBranding(value); })
      .catch(() => undefined);
    void load();
    const changed = () => void load();
    window.addEventListener("yoleotard-branding-changed", changed);
    return () => { active = false; window.removeEventListener("yoleotard-branding-changed", changed); };
  }, [enabled]);
  return branding;
}
