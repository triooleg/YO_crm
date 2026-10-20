import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source=await readFile(new URL("../src/clients/client-merge-provenance.ts",import.meta.url),"utf8"),module={exports:{}};
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(compiled,{module,exports:module.exports,require:id=>id==="@prisma/client"?{ContactChannel:Object.fromEntries(["WEBSITE","CHATWOOT","INSTAGRAM","FACEBOOK","WHATSAPP","EMAIL","TELEGRAM","REFERRAL","RETURNING_CUSTOMER","MANUAL","OTHER"].map(value=>[value,value]))}:{},Date,Object,Array,Set,Map,JSON,Error});
const {channelAccountName,clientMergeSnapshot,conditionalTargetRestore,conversationOwnerSourceId,hasValidClientMergeSnapshot,hasValidDeletedAiSettings,hasValidMovedEntityIds,legacyConversationOwnerSourceId,legacyMergeTargetClientId,legacySourceChannels,parseMovedEntityIds}=module.exports;

test("merged channel labels prefer the real channel identity",()=>{
  const client={displayName:"Lyna D",instagramUsername:"cannberley",email:"lyna@example.test"};
  assert.equal(channelAccountName(client,"INSTAGRAM"),"@cannberley");
  assert.equal(channelAccountName(client,"FACEBOOK"),"Lyna D");
  assert.equal(channelAccountName(client,"EMAIL"),"lyna@example.test");
});

test("target fields roll back only while they still equal the merge result",()=>{
  const before=clientMergeSnapshot({displayName:"Primary",phone:null,city:"Kyiv"}),after=clientMergeSnapshot({displayName:"Primary",phone:"+380501111111",city:"Kyiv"});
  const restored=conditionalTargetRestore({displayName:"Primary",phone:"+380999999999",city:"Kyiv"},before,after);
  assert.equal(restored.phone,undefined);
  assert.equal(restored.city,"Kyiv");
});

test("provenance parser fails closed and legacy channels use only stored evidence",()=>{
  assert.deepEqual(Array.from(legacySourceChannels({sourceClientId:"source",targetClientId:"target",sourceChannels:["INSTAGRAM","WHATSAPP"]},"source")),["INSTAGRAM","WHATSAPP"]);
  assert.deepEqual(Array.from(legacySourceChannels({sourceClientId:"source",targetClientId:"target",sourceChannels:["INSTAGRAM","INVALID"]},"source")),[]);
  assert.deepEqual(Array.from(legacySourceChannels({source:"WHATSAPP",instagramUsername:"lyna"},"source")),[]);
  assert.deepEqual(Array.from(parseMovedEntityIds({conversations:["conversation-1",7],orders:"invalid"}).conversations),["conversation-1"]);
  assert.equal(hasValidMovedEntityIds({conversations:["conversation-1"]}),false);
  assert.deepEqual(Array.from(parseMovedEntityIds(null).orders),[]);
});

test("nested merge account ownership is deterministic and follows the deepest source",()=>{
  const moved=conversations=>({version:1,athletes:[],orders:[],conversations,messageDeliveryAttempts:[],workTasks:[],customerMemories:[],conversationFacts:[],agreements:[],aiRuns:[],activities:[],aiModeOverrides:[],aiRuntimeSettings:[],incomingRedirects:[],sourceAiModes:[],targetAiModes:[]});
  const operations=[{sourceClientId:"source-a",targetClientId:"source-b",movedEntityIds:moved(["conversation-1"])},{sourceClientId:"source-b",targetClientId:"canonical",movedEntityIds:moved(["conversation-1"])}];
  assert.equal(conversationOwnerSourceId("conversation-1",operations,"canonical"),"source-a");
  assert.equal(conversationOwnerSourceId("conversation-1",[...operations].reverse(),"canonical"),"source-a");
});

test("complete provenance validators reject partial snapshots and AI records",()=>{
  const snapshot=clientMergeSnapshot({firstName:"Lyna",displayName:"Lyna D",source:"INSTAGRAM",status:"ACTIVE",updatedAt:new Date("2026-09-08T00:00:00Z")});
  assert.equal(hasValidClientMergeSnapshot(snapshot),true);
  assert.equal(hasValidClientMergeSnapshot({updatedAt:"2026-09-08T00:00:00Z"}),false);
  assert.equal(hasValidClientMergeSnapshot({...snapshot,updatedAt:"not-a-date"}),false);
  assert.equal(hasValidClientMergeSnapshot({...snapshot,updatedAt:"2026-09-08"}),false);
  assert.equal(hasValidClientMergeSnapshot({...snapshot,updatedAt:"2026-09-08 00:00:00Z"}),false);
  assert.equal(hasValidClientMergeSnapshot({...snapshot,updatedAt:"2026-02-30T00:00:00.000Z"}),false);
  assert.equal(hasValidClientMergeSnapshot({...snapshot,status:"UNKNOWN"}),false);
  assert.equal(hasValidClientMergeSnapshot({...snapshot,id:"replacement-id"}),false);
  assert.equal(hasValidClientMergeSnapshot({...snapshot,createdAt:"2026-09-08T00:00:00.000Z"}),false);
  const setting={id:"setting",key:"mode",value:"SHADOW",valueType:"JSON",scope:"CLIENT",scopeId:"source",channel:null,clientId:"source",conversationId:null,updatedById:null,createdAt:"2026-09-01T00:00:00.000Z",updatedAt:"2026-09-02T00:00:00.000Z"};
  assert.equal(hasValidDeletedAiSettings([setting],"source"),true);
  assert.equal(hasValidDeletedAiSettings([{...setting,clientId:"target"}],"source"),false);
  assert.equal(hasValidDeletedAiSettings([{...setting,conversationId:"conversation"}],"source"),false);
  for(const invalidDate of ["2026-09-08","2026-09-08 00:00:00Z","2026-02-30T00:00:00.000Z"])assert.equal(hasValidDeletedAiSettings([{...setting,updatedAt:invalidDate}],"source"),false);
  assert.equal(hasValidDeletedAiSettings(null,"source"),false);
  assert.equal(hasValidDeletedAiSettings([{id:"setting",key:"mode",valueType:"JSON",scope:"CLIENT"}]),false);
});

test("moved provenance rejects empty, duplicate and invalid AI identifiers",()=>{
  const valid={version:1,athletes:[],orders:[],conversations:["conversation"],messageDeliveryAttempts:[],workTasks:[],customerMemories:[],conversationFacts:[],agreements:[],aiRuns:[],activities:[],aiModeOverrides:["mode-source"],aiRuntimeSettings:[],incomingRedirects:[],sourceAiModes:[{id:"mode-source",before:"OFF",after:"SHADOW",beforeUpdatedAt:"2026-09-01T00:00:00.000Z",afterUpdatedAt:"2026-09-02T00:00:00.000Z"}],targetAiModes:[{id:"mode-target",before:"SHADOW",after:"SHADOW",beforeUpdatedAt:"2026-09-01T00:00:00.000Z",afterUpdatedAt:"2026-09-01T00:00:00.000Z"}]};
  assert.equal(hasValidMovedEntityIds(valid),true);
  assert.equal(hasValidMovedEntityIds({...valid,conversations:["conversation","conversation"]}),false);
  assert.equal(hasValidMovedEntityIds({...valid,conversations:[""]}),false);
  assert.equal(hasValidMovedEntityIds({...valid,sourceAiModes:[{...valid.sourceAiModes[0],before:"INVALID"}]}),false);
  assert.equal(hasValidMovedEntityIds({...valid,targetAiModes:[{...valid.targetAiModes[0],id:"mode-source"}]}),false);
  assert.equal(hasValidMovedEntityIds({...valid,sourceAiModes:[{...valid.sourceAiModes[0],afterUpdatedAt:"2026-09-02"}]}),false);
  assert.equal(hasValidMovedEntityIds({...valid,sourceAiModes:[{id:"mode-source",before:"OFF",after:"SHADOW"}]}),false);
  assert.equal(hasValidMovedEntityIds({...valid,sourceAiModes:[]}),false);
});

test("legacy merge evidence retains target ancestry and deterministic channel ownership",()=>{
  const leaf={sourceClientId:"leaf",targetClientId:"middle",sourceChannels:["INSTAGRAM"]};
  assert.equal(legacyMergeTargetClientId(leaf,"leaf"),"middle");
  const evidence=[{sourceClientId:"leaf",targetClientId:"middle",channels:["INSTAGRAM"]},{sourceClientId:"middle",targetClientId:"canonical",channels:["INSTAGRAM","WHATSAPP"]}];
  assert.equal(legacyConversationOwnerSourceId("INSTAGRAM",evidence,"canonical"),"leaf");
  assert.equal(legacyConversationOwnerSourceId("INSTAGRAM",[...evidence].reverse(),"canonical"),"leaf");
});
