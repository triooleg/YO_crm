import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {OrdersService}=loadTargetModule('orders/orders.service.ts');
const {CONFIRMED_WEBSITE_SOURCE}=loadTargetModule('orders/order-source.ts');
const rows=Array.from({length:521},(_,i)=>({id:String(i).padStart(4,'0'),number:'KC-'+i,sourceSystem:'KEYCRM',sourceAccount:CONFIRMED_WEBSITE_SOURCE.account,sourceLinkMode:'IMPORTED',externalId:String(i),externalData:{source_id:i<301?12:2,privateToken:'never-public'},activities:[{type:'KEYCRM_ORDER_IMPORTED',metadata:{keycrmOrderId:String(i),sourceName:i<301?'Вебсайт':'Instagram'}}],archivedAt:null,createdAt:new Date('2026-10-02'),requiredDeliveryAt:new Date('2026-10-30'),type:'CUSTOM_ORDER',discipline:'RHYTHMIC_GYMNASTICS',salesStatus:'NEW_LEAD',shippingStatus:'NOT_READY',productionStatus:'NOT_SCHEDULED',currency:'EUR',priceMinor:10000,depositRequiredMinor:5000,client:{id:'c'+i,displayName:'Client '+i,source:'INSTAGRAM'},items:[{id:'i'+i,name:'Design',quantity:1}],payments:[],files:[],invoices:[]}));
function fixture(){
 const calls=[];let transactions=0;
 const project=(row,select)=>Object.fromEntries(Object.entries(select).filter(([,spec])=>spec).map(([key,spec])=>[key,spec===true?row[key]:Array.isArray(row[key])?row[key].map(value=>project(value,spec.select)):row[key]?project(row[key],spec.select):null]));
 const db={order:{findMany:async q=>{calls.push(q);let values=rows.filter(row=>(q.where.archivedAt===undefined||row.archivedAt===q.where.archivedAt)&&(!q.where.id?.in||q.where.id.in.includes(row.id)));if(q.where.OR)values=values.filter(row=>row.number.includes(q.where.OR[0].number.contains)||row.client.displayName.includes(q.where.OR[0].number.contains));values.sort((a,b)=>a.id.localeCompare(b.id));if(q.cursor)values=values.filter(row=>row.id>q.cursor.id);if(q.take)values=values.slice(0,q.take);return values.map(row=>project(row,q.select));}}};
 const prisma={...db,$transaction:async(fn,options)=>{transactions++;assert.equal(options.isolationLevel,'RepeatableRead');return fn(db)}};
 return {service:new OrdersService(prisma,{}),calls,get transactions(){return transactions}};
}
test('paged service scans narrow bounded candidates and hydrates only chosen page IDs; totals include every batch',async()=>{
 const f=fixture(),result=await f.service.list(undefined,{page:'2',pageSize:'20',source:'WEBSITE',status:'NEW_LEAD'});
 assert.equal(result.total,301);assert.equal(result.sources.total,521);assert.equal(result.sources.websiteCount,301);assert.equal(result.items.length,20);assert.equal(f.transactions,1);
 const rich=f.calls.filter(q=>q.select.files);assert.equal(rich.length,1);assert.equal(rich[0].take,20);assert.equal(rich[0].where.id.in.length,20);
 assert.ok(f.calls.filter(q=>!q.select.files).every(q=>q.take===500));
 const json=JSON.stringify(result);assert.ok(!json.includes('privateToken'));assert.ok(!json.includes('sourceName'));assert.ok(!json.includes('externalData'));
 assert.ok(result.items.every(row=>row.orderSource==='WEBSITE'));
});
test('legacy array is backward compatible, server search composes source, invalid filters fail before any read',async()=>{
 const f=fixture(),legacy=await f.service.list();assert.ok(Array.isArray(legacy));assert.equal(legacy.length,521);assert.equal(f.transactions,0);
 const searched=await f.service.list('KC-30',{page:1,source:'WEBSITE'});assert.equal(searched.total,2);assert.equal(searched.items.length,2);
 const empty=await f.service.list('KC-520',{page:1,source:'WEBSITE'});assert.equal(empty.total,0);assert.equal(empty.sources.total,1);
 const fresh=fixture();await assert.rejects(()=>fresh.service.list('',{page:0}));assert.equal(fresh.calls.length,0);
});
test('focus and last-page clamping preserve deep links without loading all rich orders',async()=>{
 const f=fixture(),focus=await f.service.list('',{page:1,pageSize:20,source:'WEBSITE',focusId:'0299'});assert.ok(focus.items.some(row=>row.id==='0299'));assert.equal(focus.focusFound,true);
 const hidden=await f.service.list('',{page:1,source:'WEBSITE',focusId:'0520'});assert.equal(hidden.focusFound,false);
 const last=await f.service.list('',{page:999,source:'WEBSITE'});assert.equal(last.page,16);assert.equal(last.items.length,1);
});
