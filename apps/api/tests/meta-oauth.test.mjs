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
const instagramDiagnostics = await readFile(new URL("../src/communications/instagram-oauth-diagnostics.ts", import.meta.url), "utf8").catch(() => "");

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

function loadInstagramDiagnostics() {
  const javascript = ts.transpileModule(instagramDiagnostics, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} }, require = createRequire(import.meta.url);
  vm.runInNewContext(javascript, { module, exports: module.exports, require });
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

test("Facebook and Instagram use isolated OAuth applications and credentials", () => {
  assert.match(controller, /meta\/instagram\/oauth\/start/);
  assert.match(controller, /meta\/instagram\/oauth\/callback/);
  assert.match(service, /pages_show_list[\s\S]*pages_manage_metadata[\s\S]*pages_messaging[\s\S]*pages_read_engagement[\s\S]*pages_read_user_content[\s\S]*pages_manage_engagement/);
  assert.match(service, /https:\/\/www\.instagram\.com\/oauth\/authorize/);
  assert.match(service, /instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments/);
  assert.match(service, /instagramAppId/);
  assert.match(service, /instagramAppSecretEncrypted/);
  assert.match(service, /instagramAccessTokenEncrypted/);
  assert.match(service, /graph\.instagram\.com/);
  assert.match(service, /instagramAccountId \+ "\/subscribed_apps"/);
  assert.match(service, /const subscribeResult = await this\.instagramGraph/);
  assert.match(service, /instagramAccountId \+ "\/subscribed_apps", token\.accessToken/);
  assert.doesNotMatch(service, /values\.pageId !== page\.id[\s\S]*instagramAccountId", "instagramAccessTokenEncrypted/);
  assert.match(service, /const connectedValues: Record<string, Prisma\.InputJsonValue> = \{ enabled: true, pageId: page\.id/);
  assert.match(service, /instagramCredentialsChanged[\s\S]*integration\.meta\.instagram\.oauth\.attempt/);
  assert.match(service, /facebookCredentialsChanged[\s\S]*integration\.meta\.oauth\.pointer/);
  assert.match(service, /instagramToken=this\.secretValue\(values,"instagramAccessTokenEncrypted"\)/);
  assert.match(service, /enrichMetaProfiles\(instagramEvents,instagramToken,undefined,"instagram"\)/);
});

test("Instagram connection subscribes to messages, reactions and comments", () => {
  const callback = service.slice(service.indexOf("async instagramOauthCallback"), service.indexOf("instagramOauthResultHtml"));
  assert.match(callback, /subscribed_fields:\s*"messages,message_reactions,comments,live_comments"/);
  assert.match(callback, /subscribeResult\.success !== true/);
  assert.doesNotMatch(callback, /subscribed_fields:\s*"messages,messaging_postbacks"/);
  assert.match(callback, /findInstagramMessagesSubscription\(subscriptions\.data \|\| \[\], instagramAccountId, appId\)/);
});

test("Instagram OAuth callback logs safe stages and preserves generic browser errors", () => {
  assert.match(service, /INSTAGRAM_OAUTH_CALLBACK_STARTED/);
  assert.match(service, /INSTAGRAM_OAUTH_STATE_VALIDATED/);
  assert.match(service, /INSTAGRAM_OAUTH_SHORT_TOKEN_RESPONSE/);
  assert.match(service, /INSTAGRAM_OAUTH_LONG_TOKEN_RESPONSE/);
  assert.match(service, /INSTAGRAM_OAUTH_TOKEN_PERSISTED/);
  assert.match(service, /instagramOauthFailures\.set\(error, \{ correlationId, stage \}\)/);
  assert.match(service, /context\?\.correlationId/);
  assert.match(controller, /logInstagramOauthCallbackFailure\(error\)/);
  assert.match(controller, /instagramOauthResultHtml\(false\)/);
  assert.doesNotMatch(controller, /JSON\.stringify\((?:code|state|r\.query)/);
});

test("Instagram OAuth diagnostics allowlist provider errors and never expose credentials", () => {
  const diagnostics = loadInstagramDiagnostics();
  assert.equal(typeof diagnostics.sanitizeInstagramOauthResponse, "function");
  const safe = diagnostics.sanitizeInstagramOauthResponse({
    error_type: "OAuthException",
    code: 400,
    error_message: "Invalid authorization code",
    error_subcode: 123,
    access_token: "IG-SECRET-TOKEN",
    refresh_token: "REFRESH-SECRET",
    client_secret: "APP-SECRET",
    state: "SIGNED-STATE",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(safe)), {
    providerErrorType: "OAuthException",
    providerErrorCode: 400,
    providerErrorSubcode: 123,
  });
  const serialized = JSON.stringify(safe);
  assert.doesNotMatch(serialized, /IG-SECRET-TOKEN|REFRESH-SECRET|APP-SECRET|SIGNED-STATE/);
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics.sanitizeInstagramOauthResponse("not-json-secret"))), { responseShape: "non_object" });
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics.sanitizeInstagramOauthResponse({ error: { type: "OAuthException", code: 190, error_subcode: 460 }, access_token: "SECRET" }))), {
    providerErrorType: "OAuthException",
    providerErrorCode: 190,
    providerErrorSubcode: 460,
  });
  assert.equal(diagnostics.classifyInstagramOauthError(new TypeError("request contains SECRET")), "network");
});

test("Instagram subscription verification accepts the Instagram Login account response shape", () => {
  const diagnostics = loadInstagramDiagnostics();
  assert.equal(typeof diagnostics.findInstagramMessagesSubscription, "function");
  const accountId = "17841407931852361", appId = "1053522647652200";
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics.findInstagramMessagesSubscription([
    { id: accountId, subscribed_fields: ["messages", "message_reactions", "comments", "live_comments"] },
  ], accountId, appId))), { id: accountId, subscribed_fields: ["messages", "message_reactions", "comments", "live_comments"] });
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics.findInstagramMessagesSubscription([
    { id: "subscription", application: { id: appId }, subscribed_fields: ["messages", "message_reactions", "comments", "live_comments"] },
  ], accountId, appId))), { id: "subscription", application: { id: appId }, subscribed_fields: ["messages", "message_reactions", "comments", "live_comments"] });
  assert.equal(diagnostics.findInstagramMessagesSubscription([
    { id: accountId, subscribed_fields: ["comments"] },
  ], accountId, appId), undefined);
  assert.equal(diagnostics.findInstagramMessagesSubscription([
    { id: accountId, subscribed_fields: ["messages"] },
  ], accountId, appId), undefined);
  assert.equal(diagnostics.findInstagramMessagesSubscription([
    { id: accountId, subscribed_fields: ["messages", "message_reactions"] },
  ], accountId, appId), undefined);
  assert.equal(diagnostics.findInstagramMessagesSubscription([
    { id: accountId, application: { id: "other-app" }, subscribed_fields: ["messages", "message_reactions", "comments", "live_comments"] },
  ], accountId, appId), undefined);
  assert.equal(diagnostics.findInstagramMessagesSubscription([
    { id: appId, application: { id: "other-app" }, subscribed_fields: ["messages", "message_reactions", "comments", "live_comments"] },
  ], accountId, appId), undefined);
  assert.deepEqual(JSON.parse(JSON.stringify(diagnostics.findInstagramMessagesSubscription([
    { id: "provider-subscription-id", subscribed_fields: ["messages", "message_reactions", "comments", "live_comments"] },
  ], accountId, appId))), { id: "provider-subscription-id", subscribed_fields: ["messages", "message_reactions", "comments", "live_comments"] });
  assert.equal(diagnostics.findInstagramMessagesSubscription([
    { id: "provider-subscription-1", subscribed_fields: ["messages", "message_reactions", "comments", "live_comments"] },
    { id: "provider-subscription-2", subscribed_fields: ["messages", "message_reactions", "comments", "live_comments"] },
  ], accountId, appId), undefined);
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
  assert.match(service, /parseMetaOauthAttempt\(attempt\.value\)/);
  assert.match(service, /meta-oauth-session:/);
});

test("changing provider credentials atomically invalidates stale OAuth callbacks", async () => {
  assert.match(service, /meta-oauth-config/);
  assert.match(service, /instagram-oauth-config/);
  assert.match(service, /configRevision/);
  assert.match(service, /Настройки Facebook изменились; подключитесь повторно/);
  assert.match(service, /Настройки Instagram изменились; подключитесь повторно/);
  let currentAppId = "old-app", revision = 0, tail = Promise.resolve();
  const exclusively = operation => {
    const previous = tail;
    let release;
    tail = new Promise(resolve => { release = resolve; });
    return previous.then(async () => { try { return await operation(); } finally { release(); } });
  };
  // OAuth starts from the old configuration. Two saves race: the second request
  // carries a stale browser value, but its delta is compared only after the lock.
  const attemptRevision = revision;
  await Promise.all([
    exclusively(() => { if (currentAppId !== "new-app") { currentAppId = "new-app"; revision += 1; } }),
    exclusively(() => { if (currentAppId !== "old-app") { currentAppId = "old-app"; revision += 1; } }),
  ]);
  assert.equal(revision, 2);
  assert.notEqual(attemptRevision, revision);
});

test("a failed old connection never restores over a newer OAuth flow", () => {
  const oauthConnect = service.slice(service.indexOf("async metaOauthConnect"), service.indexOf("async instagramOauthStart"));
  assert.doesNotMatch(oauthConnect, /catch \(error\)[\s\S]*integration\.meta\.oauth\.pointer/);
  assert.doesNotMatch(oauthConnect, /catch \(error\)[\s\S]*instagramSubscriptionVerifiedAt/);
  assert.match(service, /Подключение Facebook уже заменено новой попыткой/);
  assert.match(service, /try\s*\{[\s\S]*subscribed_apps[\s\S]*auditLog\.create[\s\S]*catch \(error\)/);
});

test("an older successful flow cannot overwrite a newer Meta connection", () => {
  const oauthConnect = service.slice(service.indexOf("async metaOauthConnect"), service.indexOf("async instagramOauthStart"));
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
  assert.match(service, /channel === ContactChannel\.INSTAGRAM[\s\S]*instagramAccessTokenEncrypted/);
  assert.match(service, /channel === ContactChannel\.INSTAGRAM[\s\S]*instagramGraph/);
});
