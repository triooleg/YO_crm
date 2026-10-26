import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../src/orders/order-source.ts',import.meta.url),'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
class ConflictException extends Error{} class NotFoundException extends Error{}
vm.runInNewContext(javascript,{module:mod,exports:mod.exports,require:name=>name==='@nestjs/common'?{BadRequestException:Error,ConflictException,NotFoundException}:name==='@prisma/client'?{}:undefined,crypto:{randomUUID:()=>''}});
const {persistOrderSourceOverride}=mod.exports;

function fixture(current='INSTAGRAM'){
 const state={order:{id:'order-1',clientId:'client-1',number:'YO-635',archivedAt:null},activities:[],audits:[],locks:[],findArgs:[]};
 const tx={$executeRawUnsafe:async(sql,key)=>{state.locks.push({sql,key});},order:{findFirst:async(args)=>{state.findArgs.push(args);return state.order.archivedAt?null:state.order;}},activity:{findMany:async()=>[],create:async({data})=>{state.activities.unshift(data);return data;}},auditLog:{findFirst:async({where})=>state.audits.find(row=>row.requestId===where.requestId&&row.entityType===where.entityType&&row.entityId===where.entityId)??null,create:async({data})=>{state.audits.push(data);return data;}}};
 return{state,tx,current};
}

test('source override appends history and audit without mutating provider identity',async()=>{
 const{state,tx}=fixture();const before=structuredClone(state.order);
 const result=await persistOrderSourceOverride(tx,'order-1',{source:'WHATSAPP',expectedSource:'INSTAGRAM'},'owner-1',()=> 'INSTAGRAM');
 assert.equal(result.orderSource,'WHATSAPP');assert.deepEqual(state.order,before);
 assert.deepEqual(state.activities.map(row=>row.type),['ORDER_SOURCE_OVERRIDDEN']);
 assert.equal(JSON.stringify(state.activities[0].metadata),JSON.stringify({source:'WHATSAPP',previousSource:'INSTAGRAM'}));
 assert.equal(state.audits[0].entityType,'Order');assert.equal(state.audits[0].before.orderSource,'INSTAGRAM');assert.equal(state.audits[0].after.orderSource,'WHATSAPP');
 assert.equal(state.locks[0].sql,'SELECT pg_advisory_xact_lock(hashtext($1))');assert.equal(state.locks[0].key,'order-1');
 assert.equal(JSON.stringify(state.findArgs[0].select.activities.orderBy),JSON.stringify([{type:'desc'},{createdAt:'desc'},{id:'desc'}]));assert.equal(state.findArgs[0].select.activities.take,101);
});

test('replaying the same operation key does not append duplicate history',async()=>{
 const{state,tx}=fixture();
 const command={source:'WHATSAPP',expectedSource:'INSTAGRAM',operationKey:'2ae3aa9b-2c31-44c5-a13f-8932082fcce5'};
 const first=await persistOrderSourceOverride(tx,'order-1',command,'owner-1',()=> 'INSTAGRAM');
 const replay=await persistOrderSourceOverride(tx,'order-1',command,'owner-1',()=> 'INSTAGRAM');
 assert.equal(JSON.stringify(replay),JSON.stringify(first));
 assert.equal(state.activities.length,1);assert.equal(state.audits.length,1);
 await assert.rejects(()=>persistOrderSourceOverride(tx,'order-1',{...command,source:'EMAIL'},'owner-1',()=> 'WHATSAPP'),ConflictException);
 assert.equal(state.activities.length,1);assert.equal(state.audits.length,1);
});

test('stale expected source and archived orders fail closed',async()=>{
 const{state,tx}=fixture();
 await assert.rejects(()=>persistOrderSourceOverride(tx,'order-1',{source:'EMAIL',expectedSource:'FACEBOOK'},'owner-1',()=> 'INSTAGRAM'),ConflictException);
 state.order.archivedAt=new Date();await assert.rejects(()=>persistOrderSourceOverride(tx,'order-1',{source:'EMAIL',expectedSource:'INSTAGRAM'},'owner-1',()=> 'INSTAGRAM'),NotFoundException);
 assert.equal(state.activities.length,0);assert.equal(state.audits.length,0);
});
