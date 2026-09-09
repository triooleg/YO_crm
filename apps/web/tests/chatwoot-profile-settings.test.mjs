import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [settings,i18n]=await Promise.all([
  readFile(new URL("../components/settings-workspace.tsx",import.meta.url),"utf8"),
  readFile(new URL("../lib/i18n.ts",import.meta.url),"utf8"),
]);

test("настройки Chatwoot запускают постраничную синхронизацию существующих клиентов",()=>{
  assert.match(settings,/refreshChatwootProfiles/);
  assert.match(settings,/\/api\/communications\/chatwoot\/profiles\/backfill/);
  assert.match(settings,/do\{.*nextCursor.*\}while\(cursor&&batches<500\)/s);
  assert.match(settings,/type="button"[^>]*onClick=\{\(\)=>void refreshChatwootProfiles\(\)\}/);
  assert.match(i18n,/chatwootRefreshProfiles:\s*"Синхронизировать клиентов Chatwoot"/);
  assert.match(i18n,/chatwootRefreshingProfiles:\s*"Синхронизация…"/);
  assert.match(settings,/aria-busy=\{chatwootProfilesRefreshing\}/);
});
