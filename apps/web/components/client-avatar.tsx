"use client";

import { useEffect, useState } from "react";

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
}

function safeAvatarUrl(value?: string) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : "";
  } catch {
    return "";
  }
}

export function ClientAvatar({ displayName, avatarUrl, className }: { displayName: string; avatarUrl?: string; className: string }) {
  const source = safeAvatarUrl(avatarUrl);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  return (
    <span className={className} aria-label={`Аватар: ${displayName}`}>
      {source && !failed ? <img src={source} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : initials(displayName)}
    </span>
  );
}
