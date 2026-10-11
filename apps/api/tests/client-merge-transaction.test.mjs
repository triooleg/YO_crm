import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function compile(source){
  return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
}

const [serviceSource,policySource,provenanceSource]=await Promise.all([
  readFile(new URL("../src/clients/clients.service.ts",import.meta.url),"utf8"),
  readFile(new URL("../src/clients/client-merge-policy.ts",import.meta.url),"utf8"),
  readFile(new URL("../src/clients/client-merge-provenance.ts",import.meta.url),"utf8"),
]);
const policyModule={exports:{}};
vm.runInNewContext(compile(policySource),{module:policyModule,exports:policyModule.exports,Set,Map,JSON,Error});
const provenanceModule={exports:{}};
vm.runInNewContext(compile(provenanceSource),{module:provenanceModule,exports:provenanceModule.exports,require:id=>id==="@prisma/client"?{ContactChannel:Object.fromEntries(["WEBSITE","CHATWOOT","INSTAGRAM","FACEBOOK","WHATSAPP","EMAIL","TELEGRAM","REFERRAL","RETURNING_CUSTOMER","MANUAL","OTHER"].map(value=>[value,value]))}:{},Set,Map,JSON,Date,Object,Array,Error});

class BadRequestException extends Error{}
class NotFoundException extends Error{}
const serviceModule={exports:{}};
const localRequire=id=>{
  if(id==="@nestjs/common")return{BadRequestException,NotFoundException,Injectable:()=>target=>target};
  if(id==="../communications/inbound-routing")return{presentClientContact:value=>value};
  if(id==="./client-merge-policy")return policyModule.exports;
  if(id==="./client-merge-provenance")return provenanceModule.exports;
  if(id==="@prisma/client")return{Prisma:{JsonNull:{__prismaJsonNull:true}}};
  if(id==="../prisma.service"||id==="./clients.dto")return{};
  throw new Error(`Unexpected import: ${id}`);
};
vm.runInNewContext(compile(serviceSource),{module:serviceModule,exports:serviceModule.exports,require:localRequire,Set,Map,Date,Error,Promise,console});
const {ClientsService}=serviceModule.exports;

const relationNames=["athlete","order","conversation","messageDeliveryAttempt","workTask","customerMemory","conversationFact","agreement","aiRun","activity","keycrmClientLink"];

function initialState(){
  const base={firstName:"",lastName:null,avatarUrl:null,country:null,city:null,address:null,postalCode:null,email:null,phone:null,whatsapp:null,instagram:null,instagramUsername:null,facebook:null,telegram:null,preferredChannel:null,language:null,timezone:null,firstContactAt:null,lastContactAt:null,nextActionAt:null,notes:null,responsibleManagerId:null,status:"ACTIVE",source:"MANUAL",archivedAt:null,updatedAt:new Date("2026-09-01T00:00:00Z")};
  return{
    clients:[{...base,id:"target",displayName:"Основной"},{...base,id:"source",displayName:"Дубль",phone:"+380501234567"}],
    relations:Object.fromEntries(relationNames.map(name=>[name,[{id:`${name}-source`,clientId:"source"}]])),
    runtimeSettings:[{id:"target-same",clientId:"target",scope:"CLIENT",scopeId:"target",key:"mode",value:"SHADOW"},{id:"source-same",clientId:"source",scope:"CLIENT",scopeId:"source",key:"mode",value:"SHADOW"},{id:"source-only",clientId:"source",scope:"CLIENT",scopeId:"source",key:"analyzeIncoming",value:false}].map(item=>({...item,valueType:"JSON",channel:null,conversationId:null,updatedById:null,createdAt:new Date("2026-09-01T00:00:00Z"),updatedAt:new Date("2026-09-01T00:00:00Z")})),
    modeOverrides:[{id:"target-mode",clientId:"target",conversationId:null,mode:"SHADOW"},{id:"source-mode",clientId:"source",conversationId:null,mode:"OFF"}].map(item=>({...item,updatedAt:new Date("2026-09-01T00:00:00Z")})),
    redirects:[],operations:[],audits:[],createdActivities:[],
  };
}

function fakePrisma(seed,{failRelation,shortCountRelation,shortDelete,failStage}={}){
  const prisma={state:structuredClone(seed),calls:{aiModeUpdates:new Map()}};
  prisma.$transaction=async callback=>{
    const state=structuredClone(prisma.state);
    const clientById=id=>state.clients.find(client=>client.id===id);
    const matches=(row,where)=>{
      if(where.clientId!==undefined&&row.clientId!==where.clientId)return false;
      if(where.id?.in&&!where.id.in.includes(row.id))return false;
      if(where.id?.notIn&&where.id.notIn.includes(row.id))return false;
      if(typeof where.id==="string"&&row.id!==where.id)return false;
      if(where.conversationId?.in&&!where.conversationId.in.includes(row.conversationId))return false;
      if(where.orderId?.in&&!where.orderId.in.includes(row.orderId))return false;
      if(where.orderId?.notIn&&where.orderId.notIn.includes(row.orderId))return false;
      if(where.sourceMessage?.conversationId?.in&&!where.sourceMessage.conversationId.in.includes(row.sourceMessageConversationId))return false;
      if(where.channel?.in&&!where.channel.in.includes(row.channel))return false;
      if(where.mode!==undefined&&row.mode!==where.mode)return false;
      if(where.updatedAt!==undefined&&new Date(row.updatedAt).getTime()!==new Date(where.updatedAt).getTime())return false;
      if(where.OR&&!where.OR.some(condition=>matches(row,condition)))return false;
      return true;
    };
    const move=(name,where,data)=>{if(name===(prisma.failRelation||failRelation))throw new Error("forced relation failure");let count=0;for(const row of state.relations[name])if(matches(row,where)){Object.assign(row,data);count++}const short=name===(prisma.shortCountRelation||shortCountRelation)&&(!prisma.shortCountId||where.id?.in?.includes(prisma.shortCountId));return{count:short?Math.max(0,count-1):count}};
    const tx={
      $executeRaw:async()=>0,
      $queryRaw:async()=>[],
      client:{
        findFirst:async({where})=>{const client=clientById(where.id);if(!client||client.archivedAt)return null;return{...client,athletes:state.relations.athlete.filter(row=>row.clientId===client.id),orders:state.relations.order.filter(row=>row.clientId===client.id),conversations:state.relations.conversation.filter(row=>row.clientId===client.id).map(row=>({...row,channel:row.channel||"WHATSAPP"})),messageDeliveryAttempts:state.relations.messageDeliveryAttempt.filter(row=>row.clientId===client.id),workTasks:state.relations.workTask.filter(row=>row.clientId===client.id),aiMemories:state.relations.customerMemory.filter(row=>row.clientId===client.id),conversationFacts:state.relations.conversationFact.filter(row=>row.clientId===client.id),agreements:state.relations.agreement.filter(row=>row.clientId===client.id),aiRuns:state.relations.aiRun.filter(row=>row.clientId===client.id),activities:state.relations.activity.filter(row=>row.clientId===client.id),keycrmLinks:state.relations.keycrmClientLink.filter(row=>row.clientId===client.id),incomingMergeRedirects:state.redirects.filter(row=>row.targetClientId===client.id),aiRuntimeSettings:state.runtimeSettings.filter(row=>row.clientId===client.id),aiModeOverrides:state.modeOverrides.filter(row=>row.clientId===client.id)}} ,
        findUnique:async({where})=>clientById(where.id)||null,
        findUniqueOrThrow:async({where})=>{if((prisma.failStage||failStage)==="split-final-read")throw new Error("forced late-stage failure");const client=clientById(where.id);if(!client)throw new Error("missing client");return client},
        update:async({where,data})=>Object.assign(clientById(where.id),data,{updatedAt:new Date(new Date(clientById(where.id).updatedAt).getTime()+1000)}),
      },
      aiRuntimeSetting:{
        deleteMany:async({where})=>{const before=state.runtimeSettings.length;state.runtimeSettings=state.runtimeSettings.filter(row=>!matches(row,where));const count=before-state.runtimeSettings.length;return{count:shortDelete?Math.max(0,count-1):count}},
        updateMany:async({where,data})=>{let count=0;for(const row of state.runtimeSettings)if(matches(row,where)){Object.assign(row,data);count++}const short=prisma.shortCountRelation==="aiRuntimeSetting"&&(!prisma.shortCountId||where.id?.in?.includes(prisma.shortCountId));return{count:short?Math.max(0,count-1):count}},
        findMany:async({where})=>state.runtimeSettings.filter(row=>matches(row,where)).map(row=>({id:row.id})),
        createMany:async({data})=>{state.runtimeSettings.push(...data);return{count:data.length}},
      },
      aiModeOverride:{updateMany:async({where,data})=>{let count=0;for(const row of state.modeOverrides)if(matches(row,where)){Object.assign(row,data,{updatedAt:new Date(new Date(row.updatedAt).getTime()+1000)});count++;prisma.calls.aiModeUpdates.set(row.id,(prisma.calls.aiModeUpdates.get(row.id)||0)+1)}const short=prisma.shortCountRelation==="aiModeOverride"&&(!prisma.shortCountId||where.id?.in?.includes(prisma.shortCountId));return{count:short?Math.max(0,count-1):count}},findMany:async({where})=>state.modeOverrides.filter(row=>matches(row,where)).map(row=>({...row})),findFirst:async({where})=>state.modeOverrides.find(row=>matches(row,where))||null},
      clientMergeRedirect:{
        updateMany:async({where,data})=>{let count=0;for(const row of state.redirects)if((where.targetClientId===undefined||row.targetClientId===where.targetClientId)&&(!where.sourceClientId?.in||where.sourceClientId.in.includes(row.sourceClientId))){Object.assign(row,data);count++}return{count}},
        create:async({data})=>{state.redirects.push(data);if((prisma.failStage||failStage)==="merge-redirect")throw new Error("forced late-stage failure");return data},
        findUnique:async({where})=>state.redirects.find(row=>row.sourceClientId===where.sourceClientId)||null,
        findMany:async({where})=>state.redirects.filter(row=>row.targetClientId===where.targetClientId).map(row=>({sourceClientId:row.sourceClientId})),
        delete:async({where})=>{const index=state.redirects.findIndex(row=>row.sourceClientId===where.sourceClientId);return state.redirects.splice(index,1)[0]},
      },
      clientMergeOperation:{
        create:async({data})=>{const operation={id:`operation-${state.operations.length+1}`,...data,createdAt:new Date(),splitAt:null};state.operations.push(operation);if((prisma.failStage||failStage)==="merge-operation")throw new Error("forced late-stage failure");return operation},
        findFirst:async({where})=>[...state.operations].reverse().find(row=>row.sourceClientId===where.sourceClientId&&(where.targetClientId===undefined||row.targetClientId===where.targetClientId)&&!row.splitAt)||null,
        update:async({where,data})=>{const result=Object.assign(state.operations.find(row=>row.id===where.id),data);if((prisma.failStage||failStage)==="split-operation")throw new Error("forced late-stage failure");return result},
      },
      auditLog:{create:async({data})=>{state.audits.push(data);if((prisma.failStage||failStage)===`${data.action.toLowerCase()}-audit`)throw new Error("forced late-stage failure");return data}},
    };
    for(const name of relationNames){
      if(name==="activity")tx.activity={updateMany:async({where,data})=>{const moved=move(name,where,data);for(const row of state.createdActivities)if(matches(row,where)){Object.assign(row,data);moved.count++}return moved},create:async({data})=>{const row={id:`created-activity-${state.createdActivities.length+1}`,...data,createdAt:new Date()};state.createdActivities.push(row);if((prisma.failStage||failStage)===`${data.type.toLowerCase()}-activity`)throw new Error("forced late-stage failure");return row},findMany:async({where})=>state.createdActivities.filter(row=>row.clientId===where.clientId&&row.type===where.type).map(row=>({id:row.id,metadata:row.metadata}))};
      else tx[name]={updateMany:async({where,data})=>move(name,where,data),findMany:async({where})=>state.relations[name].filter(row=>matches(row,where)).map(row=>({...row}))};
    }
    const athleteCondition=(athleteId,condition)=>condition?.in?.includes(athleteId)||(condition?.notIn&&athleteId!=null&&!condition.notIn.includes(athleteId));
    const orderCondition=(row,condition)=>athleteCondition(row.athleteId,condition.athleteId)||athleteCondition(row.measurementAthleteId,condition.measurement?.athleteId)||(condition.items?.some?.OR||[]).some(itemCondition=>(row.items||[]).some(item=>athleteCondition(item.athleteId,itemCondition.athleteId)||athleteCondition(item.measurementAthleteId,itemCondition.measurement?.athleteId)));
    tx.order.findFirst=async({where})=>state.relations.order.find(row=>row.clientId===where.clientId&&(!where.id.notIn||!where.id.notIn.includes(row.id))&&(!where.id.in||where.id.in.includes(row.id))&&where.OR.some(condition=>orderCondition(row,condition)))||null;
    tx.conversation.findMany=async({where})=>state.relations.conversation.filter(row=>matches({...row,channel:row.channel||"WHATSAPP"},where)).map(row=>({...row,channel:row.channel||"WHATSAPP"}));
    const result=await callback(tx);
    prisma.state=state;
    return result;
  };
  return prisma;
}

test("merge transaction preserves relations, redirect and fail-closed AI policy",async()=>{
  const prisma=fakePrisma(initialState());
  await new ClientsService(prisma).merge("target","source",{id:"owner"});
  for(const name of relationNames)assert.equal(prisma.state.relations[name][0].clientId,"target",name);
  assert.ok(prisma.state.clients.find(client=>client.id==="source").archivedAt);
  assert.equal(JSON.stringify(prisma.state.redirects),JSON.stringify([{sourceClientId:"source",targetClientId:"target",createdById:"owner"}]));
  assert.equal(prisma.state.runtimeSettings.some(row=>row.id==="source-same"),false);
  assert.equal(prisma.state.runtimeSettings.find(row=>row.id==="source-only").scopeId,"target");
  assert.ok(prisma.state.modeOverrides.every(row=>row.clientId!=="target"||row.mode==="OFF"));
});

test("merge followed by split restores recorded ownership and keeps later target edits",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  Object.assign(prisma.state.clients.find(client=>client.id==="target"),{phone:"+380999999999",updatedAt:new Date("2026-09-02T00:00:00Z")});
  const result=await service.split("target","source",{id:"owner"});
  for(const name of relationNames)assert.equal(prisma.state.relations[name][0].clientId,"source",name);
  assert.equal(prisma.state.clients.find(client=>client.id==="source").archivedAt,null);
  assert.equal(prisma.state.clients.find(client=>client.id==="source").phone,"+380501234567");
  assert.equal(prisma.state.clients.find(client=>client.id==="target").phone,"+380999999999");
  assert.equal(result.target.phone,"+380999999999");
  assert.equal(JSON.stringify(result.movedConversationIds),JSON.stringify(["conversation-source"]));
  assert.equal(JSON.stringify(result.movedChannels),JSON.stringify(["WHATSAPP"]));
  assert.equal(JSON.stringify(result.detachedSourceClientIds),JSON.stringify(["source"]));
  assert.equal(prisma.state.redirects.length,0);
  assert.ok(prisma.state.operations[0].splitAt);
  assert.ok(prisma.state.audits.some(item=>item.action==="SPLIT"));
});

test("conversation-scoped AI override is restored exactly once",async()=>{
  const seed=initialState();
  seed.modeOverrides.push({id:"source-conversation-mode",clientId:"source",conversationId:"conversation-source",mode:"SHADOW",updatedAt:new Date("2026-09-01T00:00:00Z")});
  const prisma=fakePrisma(seed),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  await service.split("target","source",{id:"owner"});
  const override=prisma.state.modeOverrides.find(item=>item.id==="source-conversation-mode");
  assert.equal(override.clientId,"source");
  assert.equal(override.mode,"SHADOW");
  assert.equal(prisma.calls.aiModeUpdates.get("source-conversation-mode"),2);
});

test("legacy split restores evidenced channel only and never guesses order ownership",async()=>{
  const seed=initialState(),source=seed.clients.find(client=>client.id==="source");
  source.archivedAt=new Date("2026-09-08T00:00:00Z");source.source="WHATSAPP";source.whatsapp="+380501234567";
  for(const rows of Object.values(seed.relations))for(const row of rows)row.clientId="target";
  seed.redirects.push({sourceClientId:"source",targetClientId:"target",createdAt:new Date("2026-09-08T00:00:00Z")});
  seed.createdActivities.push({id:"legacy-merge",clientId:"target",type:"CLIENTS_MERGED",createdAt:new Date("2026-09-08T00:00:00Z"),metadata:{sourceClientId:"source",targetClientId:"target",sourceChannels:["WHATSAPP"]}});
  const prisma=fakePrisma(seed),result=await new ClientsService(prisma).split("target","source",{id:"owner"});
  assert.equal(result.mode,"CHANNELS_ONLY");
  assert.equal(prisma.state.relations.conversation[0].clientId,"source");
  assert.equal(prisma.state.relations.order[0].clientId,"target");
  assert.equal(prisma.state.clients.find(client=>client.id==="source").archivedAt,null);
});

test("legacy split refuses profile hints without a recorded source conversation",async()=>{
  const seed=initialState(),source=seed.clients.find(client=>client.id==="source");
  source.archivedAt=new Date("2026-09-08T00:00:00Z");source.source="WHATSAPP";source.preferredChannel="WHATSAPP";
  for(const rows of Object.values(seed.relations))for(const row of rows)row.clientId="target";
  seed.redirects.push({sourceClientId:"source",targetClientId:"target",createdAt:new Date()});
  const prisma=fakePrisma(seed);
  await assert.rejects(()=>new ClientsService(prisma).split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
  assert.deepEqual(prisma.state,seed);
});

test("redirect chains can only be split in reverse merge order",async()=>{
  const seed=initialState(),base={...seed.clients[0],id:"canonical",displayName:"Canonical"};seed.clients.push(base);
  const prisma=fakePrisma(seed),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  await service.merge("canonical","target",{id:"owner"});
  await assert.rejects(()=>service.split("canonical","source",{id:"owner"}),/CLIENT_SPLIT_ORDER/);
  await service.split("canonical","target",{id:"owner"});
  assert.equal(prisma.state.redirects.find(row=>row.sourceClientId==="source").targetClientId,"target");
  await service.split("target","source",{id:"owner"});
  assert.equal(prisma.state.redirects.length,0);
});

test("split rejects a later canonical order that references a moved athlete",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  prisma.state.relations.order.push({id:"later-order",clientId:"target",athleteId:"athlete-source"});
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_DEPENDENCY_CONFLICT/);
});

test("split fails closed when persisted provenance is malformed",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  prisma.state.operations[0].movedEntityIds={};
  const before=structuredClone(prisma.state);
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("split rejects unknown snapshot fields without changing client identity",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  prisma.state.operations[0].sourceSnapshot.id="target";
  const before=structuredClone(prisma.state);
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("split rejects nullable deleted AI provenance and rolls back",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  prisma.state.operations[0].deletedAiSettings=null;
  const before=structuredClone(prisma.state);
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("split fails closed when a recorded relation no longer belongs to the canonical client",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  prisma.state.operations[0].movedEntityIds.orders.push("missing-order");
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
});

test("split rejects a missing target AI mode row and rolls back",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  prisma.state.modeOverrides=prisma.state.modeOverrides.filter(row=>row.id!=="target-mode");
  const before=structuredClone(prisma.state);
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("split rejects a missing unchanged target AI mode row",async()=>{
  const seed=initialState();seed.modeOverrides.push({id:"target-conversation-mode",clientId:"target",conversationId:"target-conversation",mode:"SHADOW",updatedAt:new Date("2026-09-01T00:00:00Z")});
  const prisma=fakePrisma(seed),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  prisma.state.modeOverrides=prisma.state.modeOverrides.filter(row=>row.id!=="target-conversation-mode");
  const before=structuredClone(prisma.state);
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("split rejects incomplete source AI mode provenance",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  prisma.state.operations[0].movedEntityIds.sourceAiModes=[];
  const before=structuredClone(prisma.state);
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("split rejects noncanonical snapshot dates and rolls back",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  prisma.state.operations[0].sourceSnapshot.updatedAt="2026-09-08";
  const before=structuredClone(prisma.state);
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("split blocks moving an agreement whose linked order remains canonical",async()=>{
  const seed=initialState();seed.relations.order.push({id:"target-order",clientId:"target"});seed.relations.agreement[0].orderId="target-order";seed.relations.agreement[0].conversationId="conversation-source";
  const prisma=fakePrisma(seed),service=new ClientsService(prisma);await service.merge("target","source",{id:"owner"});const before=structuredClone(prisma.state);
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_DEPENDENCY_CONFLICT/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("split blocks moving an order while a canonical agreement references it",async()=>{
  const seed=initialState();seed.relations.agreement.push({id:"target-agreement",clientId:"target",conversationId:"target-conversation",orderId:"order-source"});
  const prisma=fakePrisma(seed),service=new ClientsService(prisma);await service.merge("target","source",{id:"owner"});const before=structuredClone(prisma.state);
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_DEPENDENCY_CONFLICT/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("split rejects a moved order that references a canonical athlete",async()=>{
  const seed=initialState();seed.relations.athlete.push({id:"target-athlete",clientId:"target"});seed.relations.order[0].athleteId="target-athlete";
  const prisma=fakePrisma(seed),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_DEPENDENCY_CONFLICT/);
});

test("legacy chains with distinct channels also unwind in reverse order",async()=>{
  const seed=initialState(),base={...seed.clients[0]};
  seed.clients=[{...base,id:"canonical",displayName:"Canonical"},{...base,id:"middle",displayName:"Middle",archivedAt:new Date()},{...base,id:"leaf",displayName:"Leaf",archivedAt:new Date()}];
  seed.relations.conversation=[{id:"instagram",clientId:"canonical",channel:"INSTAGRAM"},{id:"whatsapp",clientId:"canonical",channel:"WHATSAPP"}];
  for(const name of relationNames.filter(name=>name!=="conversation"))seed.relations[name]=[];
  seed.redirects=[{sourceClientId:"leaf",targetClientId:"canonical",createdAt:new Date()},{sourceClientId:"middle",targetClientId:"canonical",createdAt:new Date()}];
  seed.createdActivities=[{id:"merge-leaf",clientId:"canonical",type:"CLIENTS_MERGED",createdAt:new Date("2026-09-01"),metadata:{sourceClientId:"leaf",targetClientId:"middle",sourceChannels:["INSTAGRAM"]}},{id:"merge-middle",clientId:"canonical",type:"CLIENTS_MERGED",createdAt:new Date("2026-09-02"),metadata:{sourceClientId:"middle",targetClientId:"canonical",sourceChannels:["INSTAGRAM","WHATSAPP"]}}];
  const prisma=fakePrisma(seed),service=new ClientsService(prisma);
  await assert.rejects(()=>service.split("canonical","leaf",{id:"owner"}),/CLIENT_SPLIT_ORDER/);
  const middleSplit=await service.split("canonical","middle",{id:"owner"});
  assert.deepEqual(new Set(middleSplit.movedConversationIds),new Set(["instagram","whatsapp"]));
  assert.deepEqual(new Set(middleSplit.movedChannels),new Set(["INSTAGRAM","WHATSAPP"]));
  assert.deepEqual(new Set(middleSplit.detachedSourceClientIds),new Set(["middle","leaf"]));
  assert.equal(prisma.state.redirects.find(row=>row.sourceClientId==="leaf").targetClientId,"middle");
  await service.split("middle","leaf",{id:"owner"});
  assert.equal(prisma.state.redirects.length,0);
});

test("a later target edit is preserved even if its value returns to the merge result",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  Object.assign(prisma.state.clients.find(client=>client.id==="target"),{phone:"+380501234567",updatedAt:new Date("2026-09-03T00:00:00Z")});
  await service.split("target","source",{id:"owner"});
  assert.equal(prisma.state.clients.find(client=>client.id==="target").phone,"+380501234567");
});

test("a target AI mode changed away and back is not overwritten during split",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  Object.assign(prisma.state.modeOverrides.find(row=>row.id==="target-mode"),{mode:"OFF",updatedAt:new Date("2026-09-03T00:00:00Z")});
  await service.split("target","source",{id:"owner"});
  assert.equal(prisma.state.modeOverrides.find(row=>row.id==="target-mode").mode,"OFF");
});

test("a source AI mode changed away and back keeps the later intent after ownership restoration",async()=>{
  const seed=initialState();seed.modeOverrides.find(row=>row.id==="target-mode").mode="OFF";seed.modeOverrides.find(row=>row.id==="source-mode").mode="SHADOW";
  const prisma=fakePrisma(seed),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  Object.assign(prisma.state.modeOverrides.find(row=>row.id==="source-mode"),{mode:"OFF",updatedAt:new Date("2026-09-03T00:00:00Z")});
  await service.split("target","source",{id:"owner"});
  const restored=prisma.state.modeOverrides.find(row=>row.id==="source-mode");
  assert.equal(restored.clientId,"source");
  assert.equal(restored.mode,"OFF");
});

test("untouched merge-induced AI modes are restored for target and source",async()=>{
  const seed=initialState();seed.modeOverrides.find(row=>row.id==="target-mode").mode="OFF";seed.modeOverrides.find(row=>row.id==="source-mode").mode="SHADOW";
  const prisma=fakePrisma(seed),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  await service.split("target","source",{id:"owner"});
  assert.equal(prisma.state.modeOverrides.find(row=>row.id==="target-mode").mode,"OFF");
  assert.equal(prisma.state.modeOverrides.find(row=>row.id==="source-mode").mode,"SHADOW");
});

test("nested order measurement and group-item dependencies block ownership splits in both directions",async(t)=>{
  const references=[
    ["top-level measurement",row=>{row.measurementAthleteId="athlete-source"},row=>{row.measurementAthleteId="target-athlete"}],
    ["group item athlete",row=>{row.items=[{athleteId:"athlete-source"}]},row=>{row.items=[{athleteId:"target-athlete"}]}],
    ["group item measurement",row=>{row.items=[{measurementAthleteId:"athlete-source"}]},row=>{row.items=[{measurementAthleteId:"target-athlete"}]}],
  ];
  for(const [label,linkCanonicalToMoved,linkMovedToCanonical] of references){
    await t.test(`${label}: canonical order to moved athlete`,async()=>{const seed=initialState();seed.relations.order.push({id:"later-order",clientId:"target"});linkCanonicalToMoved(seed.relations.order.at(-1));const prisma=fakePrisma(seed),service=new ClientsService(prisma);await service.merge("target","source",{id:"owner"});await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_DEPENDENCY_CONFLICT/)});
    await t.test(`${label}: moved order to canonical athlete`,async()=>{const seed=initialState();seed.relations.athlete.push({id:"target-athlete",clientId:"target"});linkMovedToCanonical(seed.relations.order[0]);const prisma=fakePrisma(seed),service=new ClientsService(prisma);await service.merge("target","source",{id:"owner"});await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_DEPENDENCY_CONFLICT/)});
  }
});

test("split transaction restores the redirect and every prior write after a failure",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  const before=structuredClone(prisma.state);prisma.failRelation="conversation";
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/forced relation failure/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("split short-count rollback preserves the complete pre-split state",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  const before=structuredClone(prisma.state);prisma.shortCountRelation="order";
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
  assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
});

test("conversation-owned post-merge records fail closed on every short move",async(t)=>{
  const cases=["messageDeliveryAttempt","workTask","customerMemory","conversationFact","agreement","aiRun","aiModeOverride","aiRuntimeSetting"];
  for(const name of cases)await t.test(name,async()=>{
    const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
    await service.merge("target","source",{id:"owner"});
    if(name==="aiModeOverride")prisma.state.modeOverrides.push({id:"post-mode",clientId:"target",conversationId:"conversation-source",mode:"SHADOW",updatedAt:new Date("2026-09-02T00:00:00Z")});
    else if(name==="aiRuntimeSetting")prisma.state.runtimeSettings.push({id:"post-setting",clientId:"target",conversationId:"conversation-source",scope:"CONVERSATION",scopeId:"conversation-source",key:"post",value:true,valueType:"JSON",channel:null,updatedById:null,createdAt:new Date(),updatedAt:new Date()});
    else prisma.state.relations[name].push({id:`post-${name}`,clientId:"target",...(name==="workTask"||name==="customerMemory"?{sourceMessageConversationId:"conversation-source"}:{conversationId:"conversation-source"})});
    const before=structuredClone(prisma.state);prisma.shortCountRelation=name;prisma.shortCountId=name==="aiModeOverride"?"post-mode":name==="aiRuntimeSetting"?"post-setting":`post-${name}`;
    await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
    assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
  });
});

test("top-level JSON null is restored with Prisma JsonNull",async()=>{
  const seed=initialState();seed.runtimeSettings.find(row=>row.id==="target-same").value=null;seed.runtimeSettings.find(row=>row.id==="source-same").value=null;
  const prisma=fakePrisma(seed),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  await service.split("target","source",{id:"owner"});
  assert.deepEqual(prisma.state.runtimeSettings.find(row=>row.id==="source-same").value,{__prismaJsonNull:true});
});

test("a completed split cannot be repeated",async()=>{
  const prisma=fakePrisma(initialState()),service=new ClientsService(prisma);
  await service.merge("target","source",{id:"owner"});
  await service.split("target","source",{id:"owner"});
  await assert.rejects(()=>service.split("target","source",{id:"owner"}),/CLIENT_SPLIT_NOT_FOUND/);
});

test("merge transaction rolls back every prior write after a relation failure",async()=>{
  const seed=initialState(),prisma=fakePrisma(seed,{failRelation:"order"});
  await assert.rejects(()=>new ClientsService(prisma).merge("target","source",{id:"owner"}),/forced relation failure/);
  assert.deepEqual(prisma.state,seed);
});

test("merge rolls back when an exact relation move reports a short count",async()=>{
  const seed=initialState(),prisma=fakePrisma(seed,{shortCountRelation:"order"});
  await assert.rejects(()=>new ClientsService(prisma).merge("target","source",{id:"owner"}),/CLIENT_MERGE_PROVENANCE_INVALID/);
  assert.deepEqual(prisma.state,seed);
});

test("merge rolls back when an exact AI delete reports a short count",async()=>{
  const seed=initialState(),prisma=fakePrisma(seed,{shortDelete:true});
  await assert.rejects(()=>new ClientsService(prisma).merge("target","source",{id:"owner"}),/CLIENT_MERGE_PROVENANCE_INVALID/);
  assert.deepEqual(prisma.state,seed);
});

test("merge rolls back complete state including child redirects after every late-stage failure",async(t)=>{
  for(const stage of ["merge-operation","merge-redirect","clients_merged-activity","merge-audit"])await t.test(stage,async()=>{
    const seed=initialState();seed.redirects.push({sourceClientId:"child",targetClientId:"source",createdById:"owner"});const prisma=fakePrisma(seed,{failStage:stage});
    await assert.rejects(()=>new ClientsService(prisma).merge("target","source",{id:"owner"}),/forced late-stage failure/);
    assert.deepEqual(prisma.state,seed);
  });
});

test("split rolls back complete state after AI restoration, split marker, activity and audit failures",async(t)=>{
  for(const stage of ["split-operation","clients_split-activity","split-audit","split-final-read"])await t.test(stage,async()=>{
    const seed=initialState();seed.redirects.push({sourceClientId:"child",targetClientId:"source",createdById:"owner"});const prisma=fakePrisma(seed),service=new ClientsService(prisma);
    await service.merge("target","source",{id:"owner"});
    const before=structuredClone(prisma.state);prisma.failStage=stage;
    await assert.rejects(()=>service.split("target","source",{id:"owner"}),/forced late-stage failure/);
    assert.equal(JSON.stringify(prisma.state),JSON.stringify(before));
  });
});

test("legacy split rejects a partially malformed channel audit record",async()=>{
  const seed=initialState(),source=seed.clients.find(client=>client.id==="source");
  source.archivedAt=new Date("2026-09-08T00:00:00Z");
  for(const rows of Object.values(seed.relations))for(const row of rows)row.clientId="target";
  seed.redirects.push({sourceClientId:"source",targetClientId:"target",createdAt:new Date()});
  seed.createdActivities.push({id:"legacy-malformed",clientId:"target",type:"CLIENTS_MERGED",createdAt:new Date(),metadata:{sourceClientId:"source",targetClientId:"target",sourceChannels:["WHATSAPP","INVALID"]}});
  const prisma=fakePrisma(seed);
  await assert.rejects(()=>new ClientsService(prisma).split("target","source",{id:"owner"}),/CLIENT_SPLIT_PROVENANCE_INVALID/);
  assert.deepEqual(prisma.state,seed);
});

test("archived conversation channel conflict is rejected before merge writes",async()=>{
  const seed=initialState();
  seed.relations.conversation.push({id:"conversation-target-archived",clientId:"target",channel:"WHATSAPP",archivedAt:"2026-09-01"});
  const prisma=fakePrisma(seed);
  await assert.rejects(()=>new ClientsService(prisma).merge("target","source",{id:"owner"}),/CLIENT_MERGE_CHANNEL_CONFLICT/);
  assert.deepEqual(prisma.state,seed);
});

test("conflicting client AI runtime values reject merge without partial writes",async()=>{
  const seed=initialState();
  seed.runtimeSettings.find(row=>row.id==="source-same").value="OFF";
  const prisma=fakePrisma(seed);
  await assert.rejects(()=>new ClientsService(prisma).merge("target","source",{id:"owner"}),/CLIENT_MERGE_AI_RUNTIME_CONFLICT/);
  assert.deepEqual(prisma.state,seed);
});
