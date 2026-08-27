import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { createRequire } from "node:module";

const controller = await readFile(new URL("../src/communications/communications.controller.ts", import.meta.url), "utf8");
const service = await readFile(new URL("../src/communications/communications.service.ts", import.meta.url), "utf8");
const helper = await readFile(new URL("../src/communications/meta-oauth.ts", import.meta.url), "utf8").catch(() => "");
const setupHelper = await readFile(new URL("../src/communications/meta-setup-session.ts", import.meta.url), "utf8").catch(() => "");

function loadHelper() {
  const javascript = ts.transpileModule(helper, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }, require = createRequire(import.meta.url);
  vm.runInNewContext(javascript, { module, exports: module.exports, require, Buffer });
  return module.exports;
}

function loadSetupHelper() {
  const javascript = ts.transpileModule(setupHelper, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }, require = createRequire(import.meta.url);
  vm.runInNewContext(javascript, { module, exports: module.exports, require, Buffer });
  return module.exports;
}

test("Meta connection follows the KeyCRM-style OAuth wizard", () => {
  assert.match(controller, /meta\/oauth\/start/);
  assert.match(controller, /meta\/oauth\/callback/);
  assert.match(controller, /meta\/oauth\/pages/);
  assert.match(controller, /meta\/oauth\/connect/);
  assert.match(service, /graph\.facebook\.com/);
  assert.match(service, /"me\/accounts"/);
  assert.match(service, /subscribed_apps/);
});

test("Facebook reconnect stays compatible while an explicit Instagram flow requests Instagram messaging", () => {
  assert.match(controller, /channel==="instagram"/);
  assert.match(service, /const scopes=\["pages_show_list","pages_manage_metadata","pages_messaging","pages_read_engagement"\]/);
  assert.match(service, /if\(includeInstagram\)scopes\.push\("instagram_basic","instagram_manage_messages","business_management"\)/);
  assert.match(service, /accountFields=includeInstagram\?"id,name,access_token,instagram_business_account\{id,username\}":"id,name,access_token"/);
  assert.match(service, /instagram_business_account\{id,username\}/);
  assert.match(service, /if \(pending\.includeInstagram\)/);
  assert.match(service, /instagram_manage_messages/);
  assert.doesNotMatch(service, /scopes\.push\("instagram_business_basic","instagram_business_manage_messages"/);
  assert.match(service, /business_management/);
  assert.match(service, /instagramAccountId \+ "\/subscribed_apps"/);
  assert.match(service, /instagramAccountId \+ "\/subscribed_apps",page\.access_token/);
  assert.match(service, /instagramSubscribedFields=instagramApp\.subscribed_fields/);
  assert.match(service, /values\.pageId === page\.id[\s\S]*values\.instagramAccountId[\s\S]*:\s*""/);
  assert.doesNotMatch(service, /instagramAccessTokenEncrypted = encryptSecret\(pending\.instagramAccessToken!?\)/);
  assert.match(service, /values\.pageId !== page\.id[\s\S]*instagramAccountId", "instagramAccessTokenEncrypted/);
  assert.match(service, /pageToken = this\.secretValue\(values, "pageAccessTokenEncrypted"\)/);
  assert.match(service, /if\(pageToken&&instagramEvents\.length\)void this\.enrichMetaProfiles\(instagramEvents,pageToken,appSecret\)/);
  assert.doesNotMatch(service, /instagramToken=this\.secretValue\(values,"instagramAccessTokenEncrypted"\)/);
});

test("Meta OAuth requires Page messaging permissions and confirms the subscription before marking it verified", () => {
  assert.match(service, /pages_manage_metadata/);
  assert.match(service, /pages_messaging/);
  assert.match(service, /pages_read_engagement/);
  assert.match(service, /requiredPagePermissions[\s\S]*pending\.permissions\.includes/);
  assert.match(service, /subscribed_apps[\s\S]*fields:\s*"id,subscribed_fields"[\s\S]*confirmMetaPageSubscription/);
});

test("OAuth state is signed, expires and is bound to the current user", () => {
  assert.match(helper, /createHmac\("sha256"/);
  assert.match(helper, /timingSafeEqual/);
  assert.match(helper, /expiresAt/);
  assert.match(service, /state\.userId\s*!==\s*u\.id/);
});

test("OAuth state rejects tampering and expiry at runtime", () => {
  const oauth = loadHelper(), secret = "test-oauth-secret-that-is-long-enough-123";
  const signed = oauth.signMetaOauthState({ userId: "owner-1", sessionHash: "session-1", nonce: "n-1", expiresAt: 2000 }, secret);
  assert.equal(oauth.verifyMetaOauthState(signed, secret, 1000).userId, "owner-1");
  assert.throws(() => oauth.verifyMetaOauthState(signed + "x", secret, 1000));
  assert.throws(() => oauth.verifyMetaOauthState(signed, secret, 3000));
});

test("starting a reconnect invalidates a stale pending page picker", () => {
  assert.match(service, /metaOauthStart[\s\S]*?integration\.meta\.oauth\.pointer/);
  assert.match(service, /oldPointer[\s\S]*?deleteMany\(\{where:\{section:"integration\.meta\.oauth",key:oldPointer\.value/);
  assert.match(service, /integration\.meta\.oauth\.attempt/);
  assert.match(service, /attempt\.value\s*!==\s*state\.nonce/);
  assert.match(service, /meta-oauth-session:/);
});

test("a failed old connection never restores over a newer OAuth flow", () => {
  const oauthConnect = service.slice(service.indexOf("async metaOauthConnect"), service.indexOf("async metaSettings"));
  assert.doesNotMatch(oauthConnect, /catch \(error\)[\s\S]*integration\.meta\.oauth\.pointer/);
  assert.doesNotMatch(oauthConnect, /catch \(error\)[\s\S]*instagramSubscriptionVerifiedAt/);
  assert.match(service, /Подключение Facebook уже заменено новой попыткой/);
  assert.match(service, /try\s*\{[\s\S]*subscribed_apps[\s\S]*auditLog\.create[\s\S]*catch \(error\)/);
});

test("an older successful flow cannot overwrite a newer Meta connection", () => {
  const oauthConnect = service.slice(service.indexOf("async metaOauthConnect"), service.indexOf("async metaSettings"));
  const finalCommit = oauthConnect.slice(oauthConnect.indexOf("const confirmed"));
  assert.match(finalCommit, /meta-oauth-session:\"\+sessionHash/);
  assert.match(finalCommit, /const pointer = await tx\.appSetting\.findUnique/);
  assert.match(finalCommit, /pointer\.value !== flowId/);
  assert.match(finalCommit, /const activeFlow = await tx\.appSetting\.findUnique/);
  assert.match(finalCommit, /await tx\.appSetting\.delete\(\{ where: \{ section_key: \{ section: "integration\.meta\.oauth", key: flowId \} \} \}\)/);
  assert.match(finalCommit, /await tx\.appSetting\.delete\(\{ where: \{ section_key: \{ section: "integration\.meta\.oauth\.pointer", key: sessionHash \} \} \}\)/);
});

test("page access tokens are encrypted and never returned in the page picker", () => {
  assert.match(service, /encryptSecret\(JSON\.stringify/);
  assert.match(service, /pages\.map\(page\s*=>\s*\(\{\s*id:\s*page\.id,\s*name:\s*page\.name/);
  assert.doesNotMatch(service, /metaOauthPages[\s\S]*?return\s+\{\s*pages:[^;]*access_token/);
});

test("OAuth uses the temporary owner binding only when login is explicitly disabled",()=>{
  assert.match(controller,/AUTH_DISABLED[\s\S]*yoleotard_meta_setup/);
  assert.match(controller,/httpOnly:\s*true/);
  assert.match(controller,/sameSite:\s*"lax"/);
  assert.match(controller,/secure:\s*true/);
  assert.match(controller,/Для подключения Meta войдите в CRM/);
  assert.doesNotMatch(service,/AUTH_DISABLED[\s\S]*Для подключения Meta включите авторизацию CRM/);
});

test("two cookieless review browsers receive isolated signed Meta setup bindings",()=>{
  const setup = loadSetupHelper(), secret = "review-mode-secret-that-is-long-enough";
  const issuedAt = 1_000_000, first = setup.issueMetaSetupToken(secret, issuedAt), second = setup.issueMetaSetupToken(secret, issuedAt);
  assert.notEqual(first, second);
  assert.notEqual(setup.metaSetupBinding(first, secret, issuedAt + 1), setup.metaSetupBinding(second, secret, issuedAt + 1));
  assert.equal(setup.metaSetupBinding(first + "x", secret, issuedAt + 1), null);
  assert.equal(setup.metaSetupBinding("attacker-chosen", secret, issuedAt + 1), null);
  assert.equal(setup.metaSetupBinding(first, secret, issuedAt + 600_001), null);
});

test("OAuth keeps Graph tokens out of URLs",()=>{
  assert.match(service,/Authorization:\s*"Bearer "\s*\+\s*token/);
  assert.match(service,/Content-Type":\s*"application\/x-www-form-urlencoded"/);
  assert.match(service,/fb_exchange_token/);
  assert.doesNotMatch(service,/access_token:\s*token\.access_token/);
});

test("Meta connection failures identify the rejected subscription stage without exposing Graph details", () => {
  assert.match(service, /if \(structuredFailure\) throw new MetaGraphRequestError/);
  assert.match(service, /metaIntegrationFailure\(operation, response\.status, body\.error\)/);
  assert.match(service, /META_GRAPH_FAILURE operation=/);
  assert.match(service, /INSTAGRAM_SUBSCRIBE/);
  assert.match(service, /FACEBOOK_SUBSCRIBE/);
  assert.match(service, /Instagram не подтвердил подписку на сообщения/);
  assert.match(service, /Facebook не подтвердил подписку страницы/);
  assert.match(service, /receiverId \+ "\/messages"[\s\S]*appSecret,[\s\S]*true/);
});
