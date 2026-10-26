import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../src/orders/order-design-number.ts',import.meta.url),'utf8');
const javascript=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const mod={exports:{}};
vm.runInNewContext(javascript,{module:mod,exports:mod.exports,require:()=>undefined});
const {persistOrderDesignNumber,OrderDesignNumberError,ORDER_DESIGN_NUMBER_ERROR}=mod.exports;

function fixture({archivedOrder=false,archivedItem=false,completed=true}={}){
 const state={order:{id:'order-1',clientId:'client-1',number:'YO-626',archivedAt:archivedOrder?new Date():null,salesStatus:completed?'COMPLETED':'CONFIRMED',priceMinor:40000,paymentStatus:'PAID',productionStatus:'COMPLETED',productionSlot:{id:'slot-1',tentative:false}},item:{id:'item-1',orderId:'order-1',name:'Купальник',designNumber:null,archivedAt:archivedItem?new Date():null},activities:[],audits:[]};
 const tx={
  $executeRawUnsafe:async()=>undefined,
  auditLog:{findFirst:async({where})=>state.audits.find(row=>row.requestId===where.requestId&&row.entityType===where.entityType)??null,create:async({data})=>{state.audits.push(data);return data;}},
  orderItem:{findFirst:async({where})=>where.id===state.item.id&&where.orderId===state.order.id&&!state.item.archivedAt&&!state.order.archivedAt?structuredClone({...state.item,order:{clientId:state.order.clientId,number:state.order.number}}):null,update:async({data})=>{state.item={...state.item,...data};return structuredClone(state.item);}},
  activity:{create:async({data})=>{state.activities.push(data);return data;}},
 };
 return{state,tx};
}

test('номер дизайна меняется у завершённого заказа без финансовых и производственных побочных эффектов',async()=>{
 const{state,tx}=fixture(),before=structuredClone(state.order);
 const result=await persistOrderDesignNumber(tx,'order-1','item-1',{designNumber:271,expectedDesignNumber:null,operationKey:'11111111-1111-4111-8111-111111111111'},'owner-1');
 assert.equal(result.designNumber,271);assert.deepEqual(state.order,before);
 assert.deepEqual(state.activities.map(row=>row.type),['ORDER_ITEM_DESIGN_NUMBER_UPDATED']);
 assert.deepEqual(state.audits.map(row=>[row.entityType,row.before.designNumber,row.after.designNumber]),[['OrderItem',null,271]]);
});

test('тот же ключ операции безопасно возвращает результат после потерянного ответа',async()=>{
 const{state,tx}=fixture(),command={designNumber:493,expectedDesignNumber:null,operationKey:'22222222-2222-4222-8222-222222222222'};
 await persistOrderDesignNumber(tx,'order-1','item-1',command,'owner-1');
 const replay=await persistOrderDesignNumber(tx,'order-1','item-1',command,'owner-1');
 assert.equal(JSON.stringify(replay),JSON.stringify({id:'item-1',designNumber:493}));assert.equal(state.activities.length,1);assert.equal(state.audits.length,1);
 await assert.rejects(()=>persistOrderDesignNumber(tx,'order-1','item-1',{...command,designNumber:494},'owner-1'),error=>error instanceof OrderDesignNumberError&&error.code===ORDER_DESIGN_NUMBER_ERROR.operationConflict);
});

test('no-op резервирует ключ операции без ложного события изменения',async()=>{
 const{state,tx}=fixture(),operationKey='77777777-7777-4777-8777-777777777777';
 const result=await persistOrderDesignNumber(tx,'order-1','item-1',{designNumber:null,expectedDesignNumber:null,operationKey},'owner-1');
 assert.equal(JSON.stringify(result),JSON.stringify({id:'item-1',designNumber:null}));assert.equal(state.activities.length,0);assert.equal(state.audits.length,1);assert.equal(state.audits[0].action,'NOOP');
 await assert.rejects(()=>persistOrderDesignNumber(tx,'order-1','item-1',{designNumber:271,expectedDesignNumber:null,operationKey},'owner-1'),error=>error instanceof OrderDesignNumberError&&error.code===ORDER_DESIGN_NUMBER_ERROR.operationConflict);
});

test('существующий номер можно изменить и очистить с optimistic concurrency',async()=>{
 const{state,tx}=fixture({completed:false});state.item.designNumber=271;
 await persistOrderDesignNumber(tx,'order-1','item-1',{designNumber:272,expectedDesignNumber:271,operationKey:'33333333-3333-4333-8333-333333333333'},'owner-1');
 await persistOrderDesignNumber(tx,'order-1','item-1',{designNumber:null,expectedDesignNumber:272,operationKey:'44444444-4444-4444-8444-444444444444'},'owner-1');
 assert.equal(state.item.designNumber,null);
 await assert.rejects(()=>persistOrderDesignNumber(tx,'order-1','item-1',{designNumber:500,expectedDesignNumber:271,operationKey:'55555555-5555-4555-8555-555555555555'},'owner-1'),error=>error instanceof OrderDesignNumberError&&error.code===ORDER_DESIGN_NUMBER_ERROR.changed);
});

test('архивный заказ или дизайн остаются недоступными',async()=>{
 for(const options of [{archivedOrder:true},{archivedItem:true}]){const{tx}=fixture(options);await assert.rejects(()=>persistOrderDesignNumber(tx,'order-1','item-1',{designNumber:1,expectedDesignNumber:null,operationKey:'66666666-6666-4666-8666-666666666666'},'owner-1'),error=>error instanceof OrderDesignNumberError&&error.code===ORDER_DESIGN_NUMBER_ERROR.notFound);}
});
