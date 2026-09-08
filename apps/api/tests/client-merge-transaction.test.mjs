import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function compile(source){
  return ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
}

const [serviceSource,policySource]=await Promise.all([
  readFile(new URL("../src/clients/clients.service.ts",import.meta.url),"utf8"),
  readFile(new URL("../src/clients/client-merge-policy.ts",import.meta.url),"utf8"),
]);
const policyModule={exports:{}};
vm.runInNewContext(compile(policySource),{module:policyModule,exports:policyModule.exports,Set,Map,JSON,Error});

class BadRequestException extends Error{}
class NotFoundException extends Error{}
const serviceModule={exports:{}};
const localRequire=id=>{
  if(id==="@nestjs/common")return{BadRequestException,NotFoundException,Injectable:()=>target=>target};
  if(id==="../communications/inbound-routing")return{presentClientContact:value=>value};
  if(id==="./client-merge-policy")return policyModule.exports;
  if(id==="@prisma/client"||id==="../prisma.service"||id==="./clients.dto")return{};
  throw new Error(`Unexpected import: ${id}`);
};
vm.runInNewContext(compile(serviceSource),{module:serviceModule,exports:serviceModule.exports,require:localRequire,Set,Map,Date,Error,Promise,console});
const {ClientsService}=serviceModule.exports;

const relationNames=["athlete","order","conversation","messageDeliveryAttempt","workTask","customerMemory","conversationFact","agreement","aiRun","activity"];

function initialState(){
  const base={firstName:"",lastName:null,avatarUrl:null,country:null,city:null,address:null,postalCode:null,email:null,phone:null,whatsapp:null,instagram:null,instagramUsername:null,facebook:null,telegram:null,preferredChannel:null,language:null,timezone:null,firstContactAt:null,lastContactAt:null,nextActionAt:null,notes:null,responsibleManagerId:null,status:"ACTIVE",source:"MANUAL",archivedAt:null};
  return{
    clients:[{...base,id:"target",displayName:"Основной"},{...base,id:"source",displayName:"Дубль",phone:"+380501234567"}],
    relations:Object.fromEntries(relationNames.map(name=>[name,[{id:`${name}-source`,clientId:"source"}]])),
    runtimeSettings:[{id:"target-same",clientId:"target",scope:"CLIENT",scopeId:"target",key:"mode",value:"SHADOW"},{id:"source-same",clientId:"source",scope:"CLIENT",scopeId:"source",key:"mode",value:"SHADOW"},{id:"source-only",clientId:"source",scope:"CLIENT",scopeId:"source",key:"analyzeIncoming",value:false}],
    modeOverrides:[{id:"target-mode",clientId:"target",conversationId:null,mode:"SHADOW"},{id:"source-mode",clientId:"source",conversationId:null,mode:"OFF"}],
    redirects:[],audits:[],createdActivities:[],
  };
}

function fakePrisma(seed,{failRelation}={}){
  const prisma={state:structuredClone(seed)};
  prisma.$transaction=async callback=>{
    const state=structuredClone(prisma.state);
    const clientById=id=>state.clients.find(client=>client.id===id);
    const move=(name,where,data)=>{if(name===failRelation)throw new Error("forced relation failure");for(const row of state.relations[name])if(row.clientId===where.clientId)Object.assign(row,data);return{count:1}};
    const tx={
      $executeRaw:async()=>0,
      $queryRaw:async()=>[],
      client:{
        findFirst:async({where})=>{const client=clientById(where.id);if(!client||client.archivedAt)return null;return{...client,conversations:state.relations.conversation.filter(row=>row.clientId===client.id).map(row=>({channel:row.channel||"WHATSAPP"})),aiRuntimeSettings:state.runtimeSettings.filter(row=>row.clientId===client.id),aiModeOverrides:state.modeOverrides.filter(row=>row.clientId===client.id)}} ,
        update:async({where,data})=>Object.assign(clientById(where.id),data),
      },
      aiRuntimeSetting:{
        deleteMany:async({where})=>{state.runtimeSettings=state.runtimeSettings.filter(row=>!where.id.in.includes(row.id));return{count:1}},
        updateMany:async({where,data})=>{for(const row of state.runtimeSettings)if(where.id.in.includes(row.id))Object.assign(row,data);return{count:1}},
      },
      aiModeOverride:{updateMany:async({where,data})=>{for(const row of state.modeOverrides)if(row.clientId===where.clientId&&(where.conversationId===undefined||row.conversationId===where.conversationId))Object.assign(row,data);return{count:1}}},
      clientMergeRedirect:{
        updateMany:async({where,data})=>{for(const row of state.redirects)if(row.targetClientId===where.targetClientId)Object.assign(row,data);return{count:1}},
        create:async({data})=>{state.redirects.push(data);return data},
      },
      auditLog:{create:async({data})=>{state.audits.push(data);return data}},
    };
    for(const name of relationNames){
      if(name==="activity")tx.activity={updateMany:async({where,data})=>move(name,where,data),create:async({data})=>{state.createdActivities.push(data);return data}};
      else tx[name]={updateMany:async({where,data})=>move(name,where,data)};
    }
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

test("merge transaction rolls back every prior write after a relation failure",async()=>{
  const seed=initialState(),prisma=fakePrisma(seed,{failRelation:"order"});
  await assert.rejects(()=>new ClientsService(prisma).merge("target","source",{id:"owner"}),/forced relation failure/);
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
