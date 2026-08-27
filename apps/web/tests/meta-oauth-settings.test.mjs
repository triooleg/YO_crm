import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("../components/settings-workspace.tsx", import.meta.url), "utf8");
const i18n = await readFile(new URL("../lib/i18n.ts", import.meta.url), "utf8");

test("Meta settings use a Facebook popup and page picker as the primary flow", () => {
  assert.match(source, /meta\/oauth\/start/);
  assert.match(source, /window\.open/);
  assert.match(source, /meta\/oauth\/pages/);
  assert.match(source, /meta\/oauth\/connect/);
  assert.match(source, /JSON\.stringify\(\{flowId:metaFlowId,pageId\}\)/);
  assert.match(i18n, /Продолжить с Facebook/);
  assert.match(i18n, /Выберите страницу Facebook/);
});

test("manual Meta credentials remain in an explicit advanced section", () => {
  assert.match(source, /<details[^>]*className="settings-meta-advanced"/);
  assert.match(source, /settingsUi\.metaAdvanced/);
});

test("Meta settings expose a delivery verification action and honest status", () => {
  assert.match(source, /meta\/delivery\/verify/);
  assert.match(source, /metaVerifyDelivery/);
  assert.match(source, /metaDeliveryReceiving/);
  assert.match(source, /metaDeliveryNotVerified/);
  assert.match(source, /settings-meta-actions/);
});

test("Instagram OAuth polling evaluates the freshly loaded integration status", () => {
  assert.match(source, /async function load\(\)[\s\S]*?const result\s*=\s*await r\.json\(\)/);
  assert.match(source, /setData\(result\);[\s\S]*?return result/);
  assert.match(source, /const latest\s*=\s*await load\(\);[\s\S]*?latest\.meta\.instagramStatus/);
  assert.doesNotMatch(source, /await load\(\);if\(data\?\.meta\.instagramStatus/);
});

test("Instagram connect stays actionable and opens its popup synchronously", () => {
  assert.match(source, /async function connectInstagram\(\)\{[\s\S]*?if\(!data\?\.meta\.instagramAppId\|\|!data\.meta\.instagramAppSecretConfigured\)\{showInstagramCredentials\(\);return\}[\s\S]*?const popup=window\.open\("about:blank","yoleotard-instagram-oauth"/);
  assert.match(source, /const r=await fetch\("\/api\/communications\/meta\/instagram\/oauth\/start"[\s\S]*?popup\.location\.href=url/);
  assert.doesNotMatch(source, /disabled=\{oauthLoading\|\|saving\|\|!data\.meta\.instagramAppId\|\|!data\.meta\.instagramAppSecretConfigured\}/);
});

test("Instagram OAuth popup has explicit success, cancellation and timeout cleanup", () => {
  assert.match(source, /popup\.opener=null/);
  assert.match(source, /let connected=false;[\s\S]*?connected=true;break[\s\S]*?if\(popup\.closed\)throw new Error\(settingsUi\.metaOauthNotFinished\)/);
  assert.match(source, /if\(!connected\)throw new Error\(settingsUi\.metaOauthNotFinished\);popup\.close\(\)/);
  assert.match(source, /catch\(x\)\{if\(!popup\.closed\)popup\.close\(\);setError/);
});

test("Instagram reconnect ignores a subscription timestamp from an older OAuth attempt", () => {
  assert.match(source, /const subscriptionBaseline=data\.meta\.instagramSubscriptionVerifiedAt/);
  assert.match(source, /latest\.meta\.instagramSubscriptionVerifiedAt!==subscriptionBaseline/);
  assert.doesNotMatch(source, /if\(latest\.meta\.instagramStatus==="SUBSCRIBED"\|\|latest\.meta\.instagramStatus==="RECEIVING"\)\{connected=true/);
});

test("missing Instagram credentials reveal and focus the exact setup field", () => {
  assert.match(source, /useRef/);
  assert.match(source, /instagramAdvancedRef\.current\.open=true/);
  assert.match(source, /instagramAppIdRef\.current\?\.focus\(\)/);
  assert.match(source, /instagramAppSecretRef\.current\?\.focus\(\)/);
  assert.match(source, /settingsUi\.metaInstagramCredentialsHelp/);
  assert.match(source, /https:\/\/developers\.facebook\.com\/apps\//);
  assert.doesNotMatch(source, /if\(!data\?\.meta\.instagramAppId\|\|!data\.meta\.instagramAppSecretConfigured\)\{setError\(settingsUi\.metaInstagramCredentialsNeeded\);return\}/);
});
