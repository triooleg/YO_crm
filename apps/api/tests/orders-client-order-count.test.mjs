import assert from 'node:assert/strict';
import test from 'node:test';
import {loadTargetModule} from './overview-target-loader.mjs';

const {OrdersService}=loadTargetModule('orders/orders.service.ts');
const clients={a:{id:'a',displayName:'Synthetic A',source:'WEBSITE',email:'a@example.invalid',phone:'+10000000001'},b:{id:'b',displayName:'Synthetic B',source:'MANUAL',email:'b@example.invalid',phone:null}};
function makeOrder(id,client,status='NEW_LEAD',archivedAt=null){return {id,number:id,clientId:client.id,client,type:'READY_MODEL',archivedAt,createdAt:new Date('2020-01-01'),requiredDeliveryAt:null,currency:'EUR',priceMinor:10000,depositRequiredMinor:5000,salesStatus:status,productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',country:null,discipline:null,notes:null,deliveryAddressSet:false,sourceSystem:status==='NEW_LEAD'?'YOLEOTARD_WEBSITE':null,sourceAccount:status==='NEW_LEAD'?'synthetic-account':null,sourceLinkMode:status==='NEW_LEAD'?'IMPORTED':null,externalId:status==='NEW_LEAD'?id:null,externalData:status==='NEW_LEAD'?{contractVersion:1}:null,activities:status==='NEW_LEAD'?[]:[{type:'ORDER_CREATED',metadata:{}}],items:[{id:'item-'+id,name:'Synthetic design',quantity:1,archivedAt:null,instances:[],athlete:null,measurement:null}],compositionOperations:[],payments:[],athlete:null,measurement:null,productionSlot:null,shipment:null,orderShipments:[],files:[],invoices:[],expenses:[],documents:[],tags:[],notesStructured:[]};}
function matches(row,where={}){return Object.entries(where).every(([key,rule])=>{if(key==='OR')return rule.some(term=>matches(row,term));const value=row?.[key];if(rule===null||typeof rule!=='object'||rule instanceof Date)return value===rule;if('in'in rule)return rule.in.includes(value);if('contains'in rule)return String(value??'').toLowerCase().includes(rule.contains.toLowerCase());return matches(value,rule);});}
function fixture(){
 const records=[...Array.from({length:45},(_,i)=>makeOrder('A-'+String(i).padStart(2,'0'),clients.a,i<21?'NEW_LEAD':i<33?'COMPLETED':'CANCELLED')),...Array.from({length:3},(_,i)=>makeOrder('ARCHIVED-A-'+i,clients.a,'NEW_LEAD',new Date('2021-01-01'))),makeOrder('B-1',clients.b),makeOrder('B-2',clients.b,'COMPLETED')];
 const calls=[];
 function select(row,query){if(row===null||row===undefined)return row;const result={};for(const[key,choice]of Object.entries(query??{})){if(choice===true){result[key]=row[key];continue;}if(key==='_count'){result._count={};for(const[relation,spec]of Object.entries(choice.select)){const rows=relation==='orders'?records.filter(order=>order.clientId===row.id):row[relation]??[];result._count[relation]=rows.filter(value=>matches(value,spec===true?{}:spec.where)).length;}continue;}let value=key==='orders'?records.filter(order=>order.clientId===row.id):row[key];if(Array.isArray(value)){value=value.filter(value=>matches(value,choice.where));if(choice.take)value=value.slice(0,choice.take);result[key]=value.map(value=>select(value,choice.select));}else result[key]=select(value,choice.select);}return result;}
 const db={order:{findMany:async query=>{calls.push({kind:'many',query});let rows=records.filter(row=>matches(row,query.where));if(query.cursor)rows=rows.slice(rows.findIndex(row=>row.id===query.cursor.id)+(query.skip??0));if(query.take)rows=rows.slice(0,query.take);return rows.map(row=>select(row,query.select));},findFirst:async query=>{calls.push({kind:'detail',query});return select(records.find(row=>matches(row,query.where)),query.select)??null;}},payment:{findMany:async()=>{calls.push({kind:'payments'});return[];}},$transaction:async(run,options)=>{calls.push({kind:'transaction',options});return run(db);}};
 return {service:new OrdersService(db,{}),calls,records};
}

test('paged list exposes lifetime nonarchived client orderCount independent of status/source/search and page',async()=>{
 const {service,calls}=fixture();
 for(const page of ['1','2']){
  calls.length=0;const result=await service.list('Synthetic A',{page,pageSize:'20',status:'NEW_LEAD',source:'WEBSITE'});
  assert.equal(result.total,21);assert.equal(result.items.length,page==='1'?20:1);
  for(const row of result.items){assert.equal(row.client.orderCount,45);assert.equal(Object.hasOwn(row.client,'_count'),false);assert.equal(row.client.email,'a@example.invalid');}
  assert.equal(calls.filter(call=>call.kind==='many').length,3,'candidate, source and rich reads stay constant, not one read per client');
 }
});

test('legacy list returns the same lifetime count for every client without per-client reads',async()=>{
 const {service,calls}=fixture();const result=await service.list();assert.equal(result.length,47);
 assert.equal(result.filter(order=>order.client.id==='a').length,45);
 for(const row of result){assert.equal(row.client.orderCount,row.client.id==='a'?45:2);assert.equal(Object.hasOwn(row.client,'_count'),false);}
 assert.equal(calls.filter(call=>call.kind==='many').length,2);
 const filtered=await service.list('A-00',{source:'WEBSITE'});assert.equal(filtered.length,1);assert.equal(filtered[0].client.orderCount,45);
});

test('detail refresh preserves authoritative count even when recent client orders are capped at eight',async()=>{
 const {service,calls}=fixture();const list=await service.list('A-00');calls.length=0;
 const detail=await service.detail('A-00');assert.equal(detail.client.orders.length,8);assert.equal(detail.client.orderCount,45);assert.equal(detail.client.orderCount,list[0].client.orderCount);assert.equal(Object.hasOwn(detail.client,'_count'),false);assert.equal(detail.client.email,'a@example.invalid');
 assert.deepEqual(calls.map(call=>call.kind),['detail','payments','many']);
 const other=await service.detail('B-1');assert.equal(other.client.orderCount,2);assert.equal(other.client.orders.length,2);
});
