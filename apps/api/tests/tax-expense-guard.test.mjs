import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {FinanceService}=loadTargetModule('finance/finance.service.ts');
for(const action of ['updateExpense','archiveExpense'])test(`generic ${action} rejects a linked tax cash expense before any mutation`,async()=>{
 const expense={id:'tax-expense',amountMinor:10000,currency:'UAH',orderShipment:null};let mutated=false;
 const tx={expense:{findFirst:async()=>expense,update:async()=>{mutated=true;return expense}},auditLog:{create:async()=>{}}};
 const taxes={assertExpenseMutable:async(t,id)=>{assert.equal(t,tx);assert.equal(id,expense.id);throw Error('linked tax expense')}};
 const service=new FinanceService({$transaction:async fn=>fn(tx)},taxes);
 const promise=action==='updateExpense'?service.updateExpense(expense.id,{amountMinor:1},{id:'owner'}):service.archiveExpense(expense.id,{id:'owner'});
 await assert.rejects(promise,/linked tax expense/);assert.equal(mutated,false);
});

const {TaxesService}=loadTargetModule('taxes/taxes.service.ts');
for(const parcel of [false,true])for(const action of ['updateExpense','archiveExpense'])test(`ordinary ${action} remains functional with actual tax guard, parcel=${parcel}`,async()=>{
 const before={id:'ordinary-expense',categoryId:'category',amountMinor:10000,currency:'UAH',orderId:parcel?'order':null,incurredAt:new Date('2026-05-01T10:00:00Z'),orderShipment:parcel?{id:'parcel',orderId:'order',updatedAt:new Date('2026-05-01T10:00:00Z')}:null};
 const writes=[],queries=[];const tx={$executeRawUnsafe:async()=>{},$queryRawUnsafe:async(...args)=>{queries.push(args);return []},expense:{findFirst:async()=>before,update:async({data})=>{const after={...before,...Object.fromEntries(Object.entries(data).filter(([,v])=>v!==undefined))};writes.push(['expense',after]);return after}},orderShipment:{update:async({data})=>{writes.push(['parcel',data]);return {...before.orderShipment,...data}}},auditLog:{create:async data=>{writes.push(['audit',data]);return data}}};
 const service=new FinanceService({$transaction:async fn=>fn(tx)},new TaxesService({},{}));
 const result=action==='updateExpense'?await service.updateExpense(before.id,{amountMinor:12500},{id:'owner'}):await service.archiveExpense(before.id,{id:'owner'});
 assert.equal(result.id,before.id);assert.equal(result.currency,'UAH');assert.ok(queries.some(([sql,id])=>sql.includes('TaxExpenseAllocation')&&id===before.id));
 if(action==='updateExpense')assert.equal(result.amountMinor,12500);else assert.ok(result.archivedAt instanceof Date);
 const mirror=writes.find(([kind])=>kind==='parcel');assert.equal(Boolean(mirror),parcel);if(parcel)assert.equal(mirror[1].atelierCostMinor,action==='updateExpense'?12500:0);
 assert.ok(writes.some(([kind,data])=>kind==='audit'&&data.data.entityType==='Expense'));
});
