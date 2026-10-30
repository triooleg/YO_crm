import assert from 'node:assert/strict';
import test from 'node:test';
import {loadTargetModule} from './overview-target-loader.mjs';

const {OrdersService}=loadTargetModule('orders/orders.service.ts');
const clients={a:{id:'a',displayName:'Synthetic A',source:'WEBSITE',email:'a@example.invalid',phone:'+10000000001'},b:{id:'b',displayName:'Synthetic B',source:'MANUAL',email:'b@example.invalid',phone:null}};
function makeOrder(id,client,status='NEW_LEAD',archivedAt=null){return {id,number:id,clientId:client.id,client,type:'READY_MODEL',archivedAt,createdAt:new Date('2020-01-01'),requiredDeliveryAt:null,currency:'EUR',priceMinor:10000,depositRequiredMinor:5000,salesStatus:status,productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',country:null,discipline:null,notes:null,deliveryAddressSet:false,sourceSystem:status==='NEW_LEAD'?'YOLEOTARD_WEBSITE':null,sourceAccount:status==='NEW_LEAD'?'synthetic-account':null,sourceLinkMode:status==='NEW_LEAD'?'IMPORTED':null,externalId:status==='NEW_LEAD'?id:null,externalData:status==='NEW_LEAD'?{contractVersion:1}:null,activities:status==='NEW_LEAD'?[]:[{type:'ORDER_CREATED',metadata:{}}],items:[{id:'item-'+id,name:'Synthetic design',quantity:1,archivedAt:null,instances:[],athlete:null,measurement:null}],compositionOperations:[],payments:[],athlete:null,measurement:null,productionSlot:null,shipment:null,orderShipments:[],files:[],invoices:[],expenses:[],documents:[],tags:[],notesStructured:[]};}
function matches(row,where={}){return Object.entries(where).every(([key,rule])=>{if(key==='OR')return rule.some(term=>matches(row,term));if(key==='AND')return (Array.isArray(rule)?rule:[rule]).every(term=>matches(row,term));const value=row?.[key];if(rule===null||typeof rule!=='object'||rule instanceof Date)return value===rule;if('in'in rule)return rule.in.includes(value);if('contains'in rule)return String(value??'').toLowerCase().includes(rule.contains.toLowerCase());return matches(value,rule);});}
function fixture(){
 const records=[...Array.from({length:45},(_,i)=>makeOrder('A-'+String(i).padStart(2,'0'),clients.a,i<21?'NEW_LEAD':i<33?'COMPLETED':'CANCELLED')),...Array.from({length:3},(_,i)=>makeOrder('ARCHIVED-A-'+i,clients.a,'NEW_LEAD',new Date('2021-01-01'))),makeOrder('B-1',clients.b),makeOrder('B-2',clients.b,'COMPLETED')];
 const calls=[];
 function select(row,query){if(row===null||row===undefined)return row;const result={};for(const[key,choice]of Object.entries(query??{})){if(choice===true){result[key]=row[key];continue;}if(key==='_count'){result._count={};for(const[relation,spec]of Object.entries(choice.select)){const rows=relation==='orders'?records.filter(order=>order.clientId===row.id):row[relation]??[];result._count[relation]=rows.filter(value=>matches(value,spec===true?{}:spec.where)).length;}continue;}let value=key==='orders'?records.filter(order=>order.clientId===row.id):row[key];if(Array.isArray(value)){value=value.filter(value=>matches(value,choice.where));if(choice.take)value=value.slice(0,choice.take);result[key]=value.map(value=>select(value,choice.select));}else result[key]=select(value,choice.select);}return result;}
 const db={client:{findFirst:async query=>{calls.push({kind:'client',query});const client=Object.values(clients).map(c=>({...c,archivedAt:null})).find(c=>matches(c,query.where));return client?select(client,query.select):null;}},order:{groupBy:async query=>{calls.push({kind:'group',query});const counts=new Map();for(const row of records.filter(r=>matches(r,query.where)))counts.set(row.clientId,(counts.get(row.clientId)??0)+1);return [...counts].filter(([,count])=>count>=query.having.clientId._count.gte).map(([clientId])=>({clientId}));},findMany:async query=>{calls.push({kind:'many',query});let rows=records.filter(row=>matches(row,query.where));if(query.cursor)rows=rows.slice(rows.findIndex(row=>row.id===query.cursor.id)+(query.skip??0));if(query.take)rows=rows.slice(0,query.take);return rows.map(row=>select(row,query.select));},findFirst:async query=>{calls.push({kind:'detail',query});return select(records.find(row=>matches(row,query.where)),query.select)??null;}},payment:{findMany:async()=>{calls.push({kind:'payments'});return[];}},$transaction:async(run,options)=>{calls.push({kind:'transaction',options});return run(db);}};
 return {service:new OrdersService(db,{}),calls,records};
}


test('minClientOrders uses lifetime nonarchived counts, not search/source/status/page rows, before KPI facets',async()=>{
 const f=fixture();const result=await f.service.list('A-00',{minClientOrders:'45',page:'1',pageSize:'20',source:'WEBSITE',status:'NEW_LEAD'});assert.equal(result.total,1);assert.equal(result.items.length,1);assert.equal(result.items[0].client.orderCount,45);assert.equal(result.metrics.total,1);assert.equal(result.sources.websiteCount,1);
 const group=f.calls.filter(c=>c.kind==='group');assert.equal(group.length,1);assert.deepEqual(group[0].query.where,{archivedAt:null});assert.deepEqual(group[0].query.by,['clientId']);assert.deepEqual(group[0].query.having,{clientId:{_count:{gte:45}}});
 const none=await f.service.list('A-00',{minClientOrders:'46',page:'1',pageSize:'20'});assert.equal(none.total,0);assert.equal(none.metrics.total,0);assert.equal(none.sources.websiteCount,0);assert.deepEqual(none.items,[]);
});

test('paged and legacy threshold 2/3 count cancelled orders, exclude archives and intersect exact clientId',async()=>{
 const f=fixture();const two=await f.service.list(undefined,{minClientOrders:'2',page:'1',pageSize:'20',source:'WEBSITE'});assert.equal(two.total,22);assert.equal(two.metrics.total,22);assert.equal(two.sources.websiteCount,22);
 const legacyTwo=await f.service.list(undefined,{minClientOrders:2});assert.equal(legacyTwo.length,47);const three=await f.service.list(undefined,{minClientOrders:3});assert.equal(three.length,45);assert.ok(three.every(o=>o.client.id==='a'));
 for(const paged of [true,false]){const result=await f.service.list(undefined,{clientId:'b',minClientOrders:3,...(paged?{page:'1',pageSize:'20'}:{})});if(paged){assert.equal(result.total,0);assert.equal(result.clientFilter.id,'b');assert.deepEqual(result.items,[]);}else assert.deepEqual(result,[]);}
 const b=await f.service.list(undefined,{clientId:'b',minClientOrders:2,page:'1',pageSize:'20'});assert.equal(b.total,2);assert.ok(b.items.every(o=>o.client.id==='b'&&o.client.orderCount===2));
 const previous=clients.b.displayName;try{clients.b.displayName=clients.a.displayName;const sameName=await f.service.list('Synthetic A',{minClientOrders:3,page:'1',pageSize:'20'});assert.equal(sameName.total,45);assert.ok(sameName.items.every(o=>o.client.id==='a'));}finally{clients.b.displayName=previous;}
});

test('page changes do not change eligibility or KPI totals and one global aggregate is issued per request',async()=>{
 const f=fixture();for(const page of ['1','2','3']){f.calls.length=0;const result=await f.service.list(undefined,{minClientOrders:3,page,pageSize:'20'});assert.equal(result.total,45);assert.equal(result.metrics.total,45);assert.equal(result.sources.websiteCount,21);assert.equal(result.items.length,page==='3'?5:20);assert.equal(f.calls.filter(c=>c.kind==='group').length,1);assert.equal(f.calls.filter(c=>c.kind==='many').length,3);assert.equal(f.calls[0].kind,'transaction');assert.equal(f.calls[0].options.isolationLevel,'RepeatableRead');}
});

test('empty eligibility fails closed in paged/legacy including the valid upper bound',async()=>{
 const f=fixture();const paged=await f.service.list(undefined,{minClientOrders:'100000',page:'1',pageSize:'20'});assert.equal(paged.total,0);assert.equal(paged.metrics.total,0);assert.deepEqual(paged.items,[]);assert.deepEqual(await f.service.list(undefined,{minClientOrders:100000}),[]);
 f.records.splice(0,f.records.length);const empty=await f.service.list(undefined,{minClientOrders:2,page:'1',pageSize:'20'});assert.equal(empty.total,0);assert.equal(empty.sources.websiteCount,0);
});

test('invalid thresholds are 400 before any read; absence preserves exact defaults and the old query shape',async()=>{
 const {normalizeOrderListRead}=loadTargetModule('orders/order-list-read-model.ts');const defaults={focusId:undefined,source:'',page:1,pageSize:20,quick:'all',status:'all',discipline:'all',sort:'created',direction:'desc'};assert.deepEqual(normalizeOrderListRead({}),defaults);assert.deepEqual(normalizeOrderListRead({minClientOrders:undefined}),defaults);assert.deepEqual(normalizeOrderListRead({minClientOrders:'2'}),{...defaults,minClientOrders:2});
 for(const value of [null,'',0,1,-2,2.5,'2.5','2e0',' 2','2 ','NaN','Infinity',100001,Number.MAX_SAFE_INTEGER,true,{},['2','3']]){const f=fixture();await assert.rejects(()=>f.service.list(undefined,{minClientOrders:value}),e=>e.getStatus()===400,JSON.stringify(value));assert.deepEqual(f.calls,[]);}
 const f=fixture();const legacy=await f.service.list();assert.equal(legacy.length,47);assert.equal(f.calls.some(c=>c.kind==='group'||c.kind==='transaction'),false);assert.deepEqual(f.calls[0].query.where,{archivedAt:null});
});

test('many repeat clients add no per-client aggregate/lookup queries',async()=>{
 const f=fixture();for(let i=0;i<30;i++){const client={...clients.a,id:'extra-'+i,displayName:'Extra '+i};for(let j=0;j<3;j++)f.records.push(makeOrder('extra-'+i+'-'+j,client));}
 const result=await f.service.list(undefined,{minClientOrders:3});assert.equal(result.length,135);assert.equal(f.calls.filter(c=>c.kind==='group').length,1);assert.equal(f.calls.filter(c=>c.kind==='many').length,2);assert.equal(f.calls.some(c=>c.kind==='client'),false);assert.ok(result.every(o=>o.client.orderCount===(o.client.id==='a'?45:3)));
});
