import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const shell=await readFile(new URL('../components/crm-shell.tsx',import.meta.url),'utf8');
const dashboard=await readFile(new URL('../components/orders-dashboard.tsx',import.meta.url),'utf8');
const locale=await readFile(new URL('../lib/i18n.ts',import.meta.url),'utf8');
const shellCss=await readFile(new URL('../app/inbox-reference.css',import.meta.url),'utf8');

test('Orders navigation polls unread website purchases and shows a persistent actionable toast',()=>{
 assert.match(shell,/fetch\("\/api\/orders\/website-notifications"/);
 assert.match(shell,/id==="orders"\?websiteUnreadCount/);
 assert.match(shell,/notifications\.show/);assert.match(shell,/autoClose:false/);
 assert.match(shell,/navigate\("orders",\{orderId:notice\.id\}\)/);
 assert.match(locale,/newWebsitePurchase/);assert.match(locale,/newWebsiteOrder/);
 assert.match(shell,/import \{ Button \} from "@mantine\/core"/);
 assert.match(shellCss,/\.crm-notifications\{top:70px!important;bottom:auto!important\}/);assert.match(shellCss,/@media\(max-width:720px\)\{\.crm-notifications\{top:110px!important;bottom:auto!important\}\}/);
});

test('a failed acknowledgement keeps the notice retryable and does not decrement the badge',()=>{
 assert.match(shell,/if\(!response\.ok\)throw new Error\(\)/);
 assert.match(shell,/websiteNoticeRequests\.current\.invalidate\(\)/);
 assert.match(shell,/shownWebsiteNotices\.current\.delete\(orderId\)/);
 assert.doesNotMatch(shell,/finally\{setWebsiteUnreadCount/);
});

test('opening an order acknowledges its website notification and refreshes the badge',()=>{
 assert.match(dashboard,/\/website-notification\/read/);
 assert.match(dashboard,/onWebsiteOrderReviewed/);
 assert.match(dashboard,/setExpandedId\(orderId\);\s*void acknowledgeWebsiteNotification\(orderId\)/);
});
