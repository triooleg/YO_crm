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

test("merged identity prefers one canonical active client and never reactivates the archived source",()=>{
  const {inboundClientCandidates}=load();
  const archived=[{id:"source",archivedAt:"2026-09-08"}];
  assert.deepEqual(JSON.parse(JSON.stringify(inboundClientCandidates([],[{id:"target",archivedAt:null}],archived))),[{id:"target",archivedAt:null}]);
  assert.deepEqual(JSON.parse(JSON.stringify(inboundClientCandidates([],[{id:"target",archivedAt:null},{id:"target",archivedAt:null}],archived))),[{id:"target",archivedAt:null}]);
});

test("an active contact collision cannot override a different canonical redirect",()=>{
  const {inboundClientCandidates}=load();
  assert.deepEqual(JSON.parse(JSON.stringify(inboundClientCandidates([{id:"unrelated"}],[{id:"canonical"}],[]))),[{id:"unrelated"},{id:"canonical"}]);
});

test("duplicate redirects to A cannot hide a second canonical client B",()=>{
  const {inboundClientCandidates,uniqueCandidate}=load();
  const candidates=inboundClientCandidates([],[{id:"a"},{id:"a"},{id:"b"}],[]);
  assert.deepEqual(JSON.parse(JSON.stringify(candidates)),[{id:"a"},{id:"b"}]);
  assert.equal(uniqueCandidate(candidates),null);
});

test("inbound waits for a concurrent merge and re-resolves the conversation owner",async()=>{
  const {resolveCanonicalInboundClient}=load();
  let releaseLock;
  const lock=new Promise(resolve=>{releaseLock=resolve});
  let conversation={id:"conversation",clientId:"source"};
  const resolving=resolveCanonicalInboundClient({
    initialClientId:"source",
    conversationId:"conversation",
    lockClient:async()=>lock,
    findConversation:async()=>conversation,
    findRedirectTarget:async id=>id==="source"?{id:"target",archivedAt:null}:null,
    findClient:async id=>({id,archivedAt:id==="source"?"2026-09-08":null}),
  });
  conversation={id:"conversation",clientId:"target"};
  releaseLock();
  const result=await resolving;
  assert.equal(result.clientId,"target");
  assert.equal(result.client.id,"target");
  assert.equal(result.conversation.clientId,"target");
});

test("canonical inbound resolution follows the complete A to B to C redirect chain",async()=>{
  const {resolveCanonicalInboundClient}=load();
  const redirects=new Map([["a",{id:"b"}],["b",{id:"c"}]]);
  const result=await resolveCanonicalInboundClient({initialClientId:"a",lockClient:async()=>{},findConversation:async()=>null,findRedirectTarget:async id=>redirects.get(id)||null,findClient:async id=>({id})});
  assert.equal(result.clientId,"c");
  assert.equal(result.client.id,"c");
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

test("client presentation hides only a synthetic Facebook e-mail and preserves the response",()=>{
  const {presentClientContact}=load();
  const technical={id:"client-1",displayName:"Yolanda Yao",source:"FACEBOOK",facebook:"28487285184292491",email:"28487285184292491@facebook.com",country:"Ukraine"};
  assert.deepEqual(JSON.parse(JSON.stringify(presentClientContact(technical))),{...technical,email:null});
  const real={...technical,email:"Real.Customer@Example.com"};
  assert.deepEqual(JSON.parse(JSON.stringify(presentClientContact(real))),real);
  const emailChannel={...technical,source:"EMAIL",facebook:null};
  assert.deepEqual(JSON.parse(JSON.stringify(presentClientContact(emailChannel))),emailChannel);
});

test("inbound contact details fill only empty client fields",()=>{
  const {inboundClientProfilePatch}=load();
  const empty={email:null,phone:"",avatarUrl:null,city:null,country:null};
  assert.deepEqual(JSON.parse(JSON.stringify(inboundClientProfilePatch(empty,{
    email:" Customer@Example.COM ",phone:"+390123",avatarUrl:"https://example.com/a.jpg",city:"Milan",country:"Italy",
  },"CHATWOOT"))),{
    email:"customer@example.com",phone:"+390123",avatarUrl:"https://example.com/a.jpg",city:"Milan",country:"Italy",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(inboundClientProfilePatch({
    email:"manual@example.com",phone:"+3801",avatarUrl:"https://example.com/manual.jpg",city:"Kyiv",country:"Ukraine",
  },{
    email:"provider@example.com",phone:"+3901",avatarUrl:"https://example.com/provider.jpg",city:"Milan",country:"Italy",
  },"CHATWOOT"))),{});
});

test("real provider e-mail replaces a synthetic Facebook alias but invalid input does not",()=>{
  const {inboundClientProfilePatch}=load();
  assert.deepEqual(JSON.parse(JSON.stringify(inboundClientProfilePatch({email:"28487285184292491@facebook.com"},{email:"real@example.com"},"FACEBOOK"))),{email:"real@example.com"});
  assert.deepEqual(JSON.parse(JSON.stringify(inboundClientProfilePatch({email:null},{email:"not-an-email"},"CHATWOOT"))),{});
  assert.deepEqual(JSON.parse(JSON.stringify(inboundClientProfilePatch({email:null},{email:"28487285184292491@facebook.com"},"CHATWOOT"))),{});
});
