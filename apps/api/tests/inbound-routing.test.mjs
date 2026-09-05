import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const source = await readFile(new URL("../src/communications/inbound-routing.ts", import.meta.url), "utf8").catch(()=>"");
function load(){
  const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const module={exports:{}};
  vm.runInNewContext(javascript,{module,exports:module.exports});
  return module.exports;
}

test("Chatwoot scope requires both configured IDs and exact matches",()=>{
  const {chatwootScopeMatches}=load();
  assert.equal(chatwootScopeMatches({}, {accountId:"1",inboxId:"2"}),false);
  assert.equal(chatwootScopeMatches({accountId:"1"},{accountId:"1",inboxId:"2"}),false);
  assert.equal(chatwootScopeMatches({accountId:"1",inboxId:"2"},{accountId:"1",inboxId:"2"}),true);
  assert.equal(chatwootScopeMatches({accountId:"1",inboxId:"2"},{accountId:"1",inboxId:"3"}),false);
});

test("canonical identity links only when exactly one candidate exists",()=>{
  const {uniqueCandidate}=load();
  assert.equal(uniqueCandidate([]),null);
  assert.equal(uniqueCandidate([{id:"one"}]).id,"one");
  assert.equal(uniqueCandidate([{id:"one"},{id:"two"}]),null);
});

test("only technical inbound names may be replaced by a better provider name",()=>{
  const {shouldRefreshInboundDisplayName}=load();
  assert.equal(shouldRefreshInboundDisplayName("delicate-pond-188","Nicola.Faccioli","CHATWOOT","CHATWOOT"),true);
  assert.equal(shouldRefreshInboundDisplayName("Chatwoot tact-9","Nicola.Faccioli","CHATWOOT","CHATWOOT"),true);
  assert.equal(shouldRefreshInboundDisplayName("Facebook 123456","Nicola.Faccioli","META","FACEBOOK"),true);
  assert.equal(shouldRefreshInboundDisplayName("Имя исправлено вручную","Nicola.Faccioli","CHATWOOT","CHATWOOT"),false);
  assert.equal(shouldRefreshInboundDisplayName("delicate-pond-188","delicate-pond-188","CHATWOOT","CHATWOOT"),false);
});

test("Facebook SID aliases are never treated as customer e-mail",()=>{
  const {customerEmail,isSyntheticFacebookEmail}=load();
  assert.equal(isSyntheticFacebookEmail("28487285184292491@facebook.com"),true);
  assert.equal(isSyntheticFacebookEmail(" 28487285184292491@FACEBOOK.COM "),true);
  assert.equal(customerEmail("28487285184292491@facebook.com","FACEBOOK"),undefined);
  assert.equal(customerEmail("real.customer@example.com","FACEBOOK"),"real.customer@example.com");
  assert.equal(customerEmail("28487285184292491@facebook.com","EMAIL"),"28487285184292491@facebook.com");
});
