import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './website-test-loader.mjs';
const {OrdersService}=loadTargetModule('orders/orders.service.ts');
const {FinanceReportService}=loadTargetModule('finance/finance-report.service.ts');
const {legacyOrderNumberAlias}=loadTargetModule('website-orders/website-order-number.ts');
function matches(row,where={}){return Object.entries(where).every(([k,v])=>{
 if(k==='OR')return v.some(w=>matches(row,w));if(k==='AND')return v.every(w=>matches(row,w));if(v===null||typeof v!=='object')return row?.[k]===v;
 if(k==='metadata')return v.path.reduce((o,p)=>o?.[p],row.metadata)===v.equals;
 if(v.some)return (row[k]??[]).some(r=>matches(r,v.some));if(v.in)return v.in.includes(row[k]);if(v.contains!==undefined)return typeof row[k]==='string'&&row[k].toLowerCase().includes(v.contains.toLowerCase());return matches(row[k]??{},v);
});}
function fixture(){const client={id:'client',displayName:'Synthetic',source:'MANUAL',_count:{orders:1}},records=[{id:'renamed',clientId:'client',number:'24-671',client,activities:[{type:'ORDER_NUMBER_YEAR_PREFIX_CHANGED',metadata:{oldNumberSearch:'YO-671'}}],archivedAt:null,createdAt:new Date('2024-01-01'),requiredDeliveryAt:null,priceMinor:100,currency:'EUR',depositRequiredMinor:50,salesStatus:'NEW_LEAD',productionStatus:'NOT_SCHEDULED',paymentStatus:'UNPAID',shippingStatus:'NOT_READY',sourceSystem:null,items:[],payments:[],invoices:[],orderShipments:[],compositionOperations:[],_count:{items:0}},{id:'compound',clientId:'client',number:'26-26-0001',client,activities:[{type:'ORDER_NUMBER_YEAR_PREFIX_CHANGED',metadata:{oldNumberSearch:'YO-26-0001'}}],archivedAt:null,createdAt:new Date('2026-01-01'),priceMinor:100,currency:'EUR',depositRequiredMinor:50,salesStatus:'NEW_LEAD',productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',items:[],payments:[],invoices:[],orderShipments:[],compositionOperations:[],_count:{items:0}}];
 const db={order:{findMany:async({where})=>structuredClone(records.filter(r=>matches(r,where)))}};db.$transaction=async fn=>fn(db);return db;}
test('exact legacy aliases are bounded audit-backed predicates; ordinary partial searches keep existing semantics',()=>{
 assert.deepEqual(legacyOrderNumberAlias(' yo-671 '),{activities:{some:{type:'ORDER_NUMBER_YEAR_PREFIX_CHANGED',metadata:{path:['oldNumberSearch'],equals:'YO-671'}}}});
 for(const q of ['671','YO-','YO-client',undefined,'YO-'+('1'.repeat(200))])assert.equal(legacyOrderNumberAlias(q),undefined);
});
test('real Orders paged/legacy and finance lookup find current IDs by old YO aliases without number suffix heuristics',async()=>{
 const db=fixture(),orders=new OrdersService(db,{}),finance=new FinanceReportService(db,{});
 for(const [search,id,number]of [['YO-671','renamed','24-671'],['yo-26-0001','compound','26-26-0001']]){
  const legacy=await orders.list(search);assert.deepEqual(legacy.map(r=>r.id),[id]);assert.equal(legacy[0].number,number);
  const paged=await orders.list(search,{page:'1',pageSize:'20'});assert.deepEqual(paged.items.map(r=>r.id),[id]);assert.equal(paged.total,1);
  const options=await finance.options(search);assert.deepEqual(options.orders.map(r=>r.id),[id]);
 }
 assert.deepEqual(await orders.list('YO-999'),[]);
});
