import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
const css=await readFile(new URL("../app/crm-shell.css",import.meta.url),"utf8");
const inboxCss=await readFile(new URL("../app/inbox-reference.css",import.meta.url),"utf8");
test("все разделы используют одну верхнюю навигацию без бокового меню",()=>{assert.match(shell,/className="crm-shell inbox-reference-shell"/);assert.match(shell,/<header className="crm-topbar">/);assert.match(shell,/const topbarItems = \[items\[0\].*items\[8\]\]/);assert.doesNotMatch(shell,/<aside className="crm-nav">/);assert.doesNotMatch(shell,/crm-nav-label/);assert.doesNotMatch(shell,/nav-collapsed/);assert.doesNotMatch(shell,/setCollapsed/);assert.doesNotMatch(shell,/crm-collapse/);assert.match(shell,/title=\{id==="inbox"&&unreadState==="ready"&&unreadCount\?/);assert.match(inboxCss,/grid-template-columns:minmax\(0,1fr\)/)});
test("клиенты и доставка не занимают отдельные пункты верхнего меню",()=>{
  assert.match(shell,/const topbarItems = \[items\[0\], items\[1\], items\[3\], items\[4\], items\[5\], items\[7\], items\[8\]\]/);
  assert.doesNotMatch(shell,/const topbarItems = .*items\[2\]/);
  assert.doesNotMatch(shell,/const topbarItems = .*items\[6\]/);
});
test("поиск и уведомления из общей шапки открывают входящие",()=>{assert.match(shell,/updateGlobalSearch/);assert.match(shell,/sectionId!=="inbox"\)navigate\("inbox"\)/);assert.match(shell,/onClick=\{showUnread\}/)});
test("колокольчик, пункт Входящие и вкладка браузера показывают общий счётчик непрочитанных",()=>{
  assert.match(shell,/fetch\("\/api\/communications\/unread-count"/);
  assert.match(shell,/setInterval\(refreshUnreadCount,5000\)/);
  assert.match(shell,/crm-topbar-notification-badge/);
  assert.match(shell,/crm-topbar-nav-badge/);
  assert.match(shell,/applyUnreadBrowserState/);
  assert.match(shell,/unreadRequests\.current\.invalidate\(\)/);
  assert.match(shell,/onUnreadRefresh=\{\(\)=>void refreshUnreadCount\(\)\}/);
  assert.match(inboxCss,/\.crm-topbar-notifications\.has-unread/);
  assert.match(inboxCss,/\.crm-topbar-notification-badge/);
  assert.match(inboxCss,/\.crm-topbar-nav-badge/);
});
test("из входящих можно создать клиента с источником",()=>{assert.match(shell,/Клиент из входящих/);assert.match(shell,/source:data.source/);assert.match(shell,/fetch\("\/api\/clients"/)});
