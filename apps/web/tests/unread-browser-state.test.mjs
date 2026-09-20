import test from "node:test";
import assert from "node:assert/strict";
import {
  browserTitleWithUnread,
  createUnreadRequestGuard,
  notificationFaviconHref,
  unreadBadgeText,
} from "../lib/unread-browser-state.ts";

test("счётчик непрочитанных ограничивается компактным значением 99+", () => {
  assert.equal(unreadBadgeText(0), "");
  assert.equal(unreadBadgeText(8), "8");
  assert.equal(unreadBadgeText(123), "99+");
});

test("заголовок браузера содержит число новых сообщений только когда они есть", () => {
  assert.equal(browserTitleWithUnread(0, "CRM Yoleotard"), "CRM Yoleotard");
  assert.equal(browserTitleWithUnread(12, "CRM Yoleotard"), "(12) CRM Yoleotard");
  assert.equal(browserTitleWithUnread(123, "CRM Yoleotard"), "(99+) CRM Yoleotard");
});

test("favicon получает красный индикатор только при непрочитанных", () => {
  assert.equal(notificationFaviconHref(0), "/icon.svg");
  const active = decodeURIComponent(notificationFaviconHref(4));
  assert.match(active, /^data:image\/svg\+xml,/);
  assert.match(active, /#ef4444/);
  assert.match(active, />4<\/text>/);
});

test("устаревший запрос счётчика не отменяет более новое локальное прочтение", () => {
  const guard = createUnreadRequestGuard();
  const staleRequest = guard.begin();
  guard.invalidate();
  assert.equal(guard.isCurrent(staleRequest), false);
  const reconciliationRequest = guard.begin();
  assert.equal(guard.isCurrent(reconciliationRequest), true);
});
