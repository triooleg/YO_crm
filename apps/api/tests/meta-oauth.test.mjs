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

test("Facebook Page connection does not request unavailable Instagram scopes", () => {
  assert.match(service, /scope",\s*"pages_show_list,pages_manage_metadata,pages_messaging"/);
  assert.doesNotMatch(service, /scope",[^\n]*instagram_basic/);
  assert.doesNotMatch(service, /scope",[^\n]*instagram_manage_messages/);
  assert.doesNotMatch(service, /if\(page\.instagram_business_account[\s\S]*Facebook не предоставил разрешения для сообщений Instagram/);
});

test("Meta OAuth requires Page messaging permissions and confirms the subscription before marking it verified", () => {
  assert.match(service, /pages_manage_metadata/);
  assert.match(service, /pages_messaging/);
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
  assert.match(service, /const \[attempt,currentPointer\]=await Promise\.all/);
  assert.match(service, /if\(!attempt&&!currentPointer\)/);
  assert.match(service, /Подключение Facebook уже заменено новой попыткой/);
  assert.match(service, /try\s*\{[\s\S]*subscribed_apps[\s\S]*auditLog\.create[\s\S]*catch \(error\)/);
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
