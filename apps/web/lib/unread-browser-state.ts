const DEFAULT_FAVICON = "/icon.svg";

function normalizedUnreadCount(value: number) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

export function createUnreadRequestGuard() {
  let revision = 0;
  return {
    begin() {
      revision += 1;
      return revision;
    },
    invalidate() {
      revision += 1;
    },
    isCurrent(requestRevision: number) {
      return requestRevision === revision;
    },
  };
}

export function unreadBadgeText(value: number) {
  const count = normalizedUnreadCount(value);
  if (!count) return "";
  return count > 99 ? "99+" : String(count);
}

export function browserTitleWithUnread(value: number, baseTitle: string) {
  const badge = unreadBadgeText(value);
  return badge ? `(${badge}) ${baseTitle}` : baseTitle;
}

export function notificationFaviconHref(value: number) {
  const count = normalizedUnreadCount(value);
  if (!count) return DEFAULT_FAVICON;
  const label = count > 9 ? "9+" : String(count);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#7040ed"/><text x="27" y="44" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="800" fill="white">Y</text><circle cx="50" cy="14" r="13" fill="#ef4444" stroke="white" stroke-width="3"/><text x="50" y="19" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="800" fill="white">${label}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function applyUnreadBrowserState(value: number, baseTitle: string) {
  document.title = browserTitleWithUnread(value, baseTitle);
  if (!normalizedUnreadCount(value)) {
    return () => {
      document.title = baseTitle;
    };
  }
  const icon = document.createElement("link");
  icon.rel = "icon";
  icon.type = "image/svg+xml";
  icon.dataset.yoleotardUnreadIcon = "true";
  icon.href = notificationFaviconHref(value);
  document.head.append(icon);
  return () => {
    document.title = baseTitle;
    icon.remove();
  };
}
