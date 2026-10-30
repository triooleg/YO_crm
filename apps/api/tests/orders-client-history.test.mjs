import assert from 'node:assert/strict';
import test from 'node:test';
import {loadTargetModule} from './overview-target-loader.mjs';
const {OrdersService}=loadTargetModule('orders/orders.service.ts');
const A='caaaaaaaaaaaaaaaaaaaaaaaa', B='cbbbbbbbbbbbbbbbbbbbbbbbb', ARCHIVED='ccccccccccccccccccccccccc';
const clients=[{id:A,displayName:'Synthetic same name',country:'UA',source:'INSTAGRAM',email:'private@example.invalid',archivedAt:null},{id:B,displayName:'Synthetic same name',country:'PL',source:'MANUAL',archivedAt:null},{id:ARCHIVED,displayName:'Archived synthetic',country:null,source:'MANUAL',archivedAt:new Date()}];
function makeOrder(id,clientId,salesStatus='NEW_LEAD',archivedAt=null){return {id,clientId,client:clients.find(c=>c.id===clientId),number:'YO-'+id,createdAt:new Date('2026-01-01'),archivedAt,priceMinor:12345,currency:'EUR',salesStatus,type:'READY_MODEL',productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',depositRequiredMinor:5000,requiredDeliveryAt:null,sourceSystem:null,sourceAccount:null,externalId:null,externalData:null,activities:[{type:'ORDER_CREATED'}],compositionOperations:[],items:[{id:'item-'+id,name:'Synthetic',quantity:2,archivedAt:null,instances:[]}],payments:[],invoices:[],files:[],athlete:null,measurement:null,shipment:null,orderShipments:[],productionSlot:null};}
function matches(row,where={}){return Object.entries(where).every(([key,value])=>{if(key==='OR')return value.some(term=>matches(row,term));const got=row?.[key];if(value===null||typeof value!=='object'||value instanceof Date)return got===value;if('in'in value)return value.in.includes(got);if('contains'in value)return String(got??'').toLowerCase().includes(value.contains.toLowerCase());return matches(got,value);});}
function fixture(){
 const orders=[...Array.from({length:45},(_,i)=>makeOrder(String(i).padStart(3,'0'),A,i<30?'NEW_LEAD':i<40?'COMPLETED':'CANCELLED')),makeOrder('a-archived',A,'COMPLETED',new Date()),makeOrder('foreign',B),makeOrder('client-archived',ARCHIVED)];const calls=[];
 function select(row,fields){if(row==null)return row;return Object.fromEntries(Object.entries(fields).map(([key,rule])=>{if(rule===true)return[key,row[key]];if(key==='_count'){return[key,Object.fromEntries(Object.entries(rule.select).map(([relation,spec])=>{const related=relation==='orders'?orders.filter(o=>o.clientId===row.id):row[relation]??[];return[relation,related.filter(o=>matches(o,spec===true?{}:spec.where)).length];}))];}const value=row[key];return[key,Array.isArray(value)?value.filter(x=>matches(x,rule.where)).slice(0,rule.take??value.length).map(x=>select(x,rule.select)):select(value,rule.select)];}));}
 const groupRows=(rows,q)=>{const key=q.by[0],groups=new Map();for(const row of rows){const value=row[key];let g=groups.get(value);if(!g){g={[key]:value,_count:{_all:0},_sum:{}};for(const field of Object.keys(q._sum??{}))g._sum[field]=0;groups.set(value,g);}g._count._all++;for(const field of Object.keys(q._sum??{}))g._sum[field]+=row[field];}return [...groups.values()];};
 const db={client:{findFirst:async q=>{calls.push({kind:'client',q});return select(clients.find(c=>matches(c,q.where)),q.select)??null;}},order:{groupBy:async q=>{calls.push({kind:'group',q});return groupRows(orders.filter(o=>matches(o,q.where)),q);},findMany:async q=>{calls.push({kind:'orders',q});let rows=orders.filter(o=>matches(o,q.where));if(Array.isArray(q.orderBy))rows.sort((a,b)=>{for(const part of q.orderBy){const[field,direction]=Object.entries(part)[0],x=a[field],y=b[field],comparison=x instanceof Date?x-y:String(x??'').localeCompare(String(y??''));if(comparison)return comparison*(direction==='desc'?-1:1);}return 0;});if(q.cursor)rows=rows.slice(rows.findIndex(o=>o.id===q.cursor.id)+(q.skip??0));else rows=rows.slice(q.skip??0);if(q.take!==undefined)rows=rows.slice(0,q.take);return rows.map(o=>select(o,q.select));}},orderItem:{groupBy:async q=>{calls.push({kind:'itemGroup',q});return groupRows(orders.flatMap(o=>o.items.map(item=>({...item,orderId:o.id,order:o}))).filter(item=>matches(item,q.where)),q);}},$transaction:async(run,options)=>{calls.push({kind:'transaction',options});return run(db);}};
 return {service:new OrdersService(db,{}),calls,orders,clients};
}

test('client history is bounded, nonarchived, identity-exact and disjoint across every category',async()=>{
 const {service,calls}=fixture();const page=await service.clientHistory(A,{page:'1',pageSize:'20'});
 assert.deepEqual(page.client,{id:A,displayName:'Synthetic same name',country:'UA',source:'INSTAGRAM'});
 assert.deepEqual(page.summary,{total:45,completed:10,inProgress:30,cancelled:5});assert.equal(page.total,45);assert.equal(page.page,1);assert.equal(page.pageSize,20);assert.equal(page.items.length,20);
 assert.ok(page.items.every(o=>o.clientId===A));assert.equal(page.items[0].id,'044');assert.deepEqual(Object.keys(page.items[0]).sort(),['clientId','country','createdAt','currency','designCount','designs','id','number','priceMinor','quantity','salesStatus']);
 assert.deepEqual(calls.map(c=>c.kind),['transaction','client','group','group','orders','itemGroup']);assert.equal(calls[0].options.isolationLevel,'RepeatableRead');assert.deepEqual(calls.findLast(c=>c.kind==='orders').q.orderBy,[{createdAt:'desc'},{id:'desc'}]);assert.equal(calls.findLast(c=>c.kind==='orders').q.take,20);
});

test('history clamps a shrinking result to the last page and keeps empty clients on page one',async()=>{
 const {service,calls,orders}=fixture();const page=await service.clientHistory(A,{page:'99',pageSize:'20'});assert.equal(page.page,3);assert.equal(page.items.length,5);assert.equal(calls.findLast(c=>c.kind==='orders').q.skip,40);
 orders.splice(0,orders.length,...orders.filter(o=>o.clientId!==A));const empty=await service.clientHistory(A,{page:'99',pageSize:'50'});assert.deepEqual(empty.summary,{total:0,completed:0,inProgress:0,cancelled:0});assert.equal(empty.page,1);assert.equal(empty.total,0);assert.deepEqual(empty.items,[]);assert.equal(calls.findLast(c=>c.kind==='orders').q.skip,0);
});

test('paged and legacy list filter by client identity even when names match, and paged metadata survives no matches',async()=>{
 const {service,calls}=fixture();const page=await service.list('Synthetic same name',{clientId:A,page:'1',pageSize:'20'});assert.equal(page.total,45);assert.equal(page.items.length,20);assert.ok(page.items.every(o=>o.client.id===A));assert.deepEqual(page.clientFilter,{id:A,displayName:'Synthetic same name',country:'UA',source:'INSTAGRAM'});assert.ok(page.items.every(o=>o.client.orderCount===45));
 const legacy=await service.list('Synthetic same name',{clientId:B});assert.equal(legacy.length,1);assert.equal(legacy[0].client.id,B);assert.equal(legacy[0].client.orderCount,1);
 const empty=await service.list('not-present-in-fixtures',{clientId:A,page:'1',pageSize:'20'});assert.equal(empty.items.length,0);assert.equal(empty.total,0);assert.equal(empty.clientFilter.displayName,'Synthetic same name');
 const unfiltered=await service.list('Synthetic same name',{page:'1',pageSize:'20'});assert.equal(unfiltered.total,46);assert.equal(Object.hasOwn(unfiltered,'clientFilter'),false);
 assert.ok(calls.filter(c=>c.kind==='transaction').every(c=>c.options.isolationLevel==='RepeatableRead'));
});

test('existing opaque non-CUID client IDs work in history and exact list filters',async t=>{
 const f=fixture(),id='legacy-client:2020-42',client={...clients[0],id};f.clients.push(client);t.after(()=>f.clients.splice(f.clients.indexOf(client),1));f.orders.push(makeOrder('legacy-order',id));
 const history=await f.service.clientHistory(id);assert.equal(history.client.id,id);assert.equal(history.total,1);assert.equal(history.items[0].clientId,id);
 const page=await f.service.list(undefined,{clientId:id,page:'1',pageSize:'20'});assert.equal(page.total,1);assert.equal(page.clientFilter.id,id);assert.equal(page.items[0].client.id,id);
 const legacy=await f.service.list(undefined,{clientId:id});assert.equal(legacy.length,1);assert.equal(legacy[0].client.id,id);
});

import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
test('malformed IDs are 400 while valid missing/archived IDs are 404, never an unfiltered read',async()=>{
 for(const [id,status] of [['',400],[null,400],[undefined,400],['bad id',400],[A+' ',400],['x'.repeat(201),400],['control\u0000id',400],[[A,B],400],['legitimate-but-missing',404],[ARCHIVED,404]]){
  const f=fixture();await assert.rejects(()=>f.service.clientHistory(id),error=>error.getStatus()===status);assert.equal(f.calls.some(c=>['group','orders'].includes(c.kind)),false);
  if(id!==undefined)for(const paged of [false,true]){f.calls.length=0;await assert.rejects(()=>f.service.list(undefined,{clientId:id,...(paged?{page:'1',pageSize:'20'}:{})}),error=>error.getStatus()===status);assert.equal(f.calls.some(c=>c.kind==='orders'),false);}
 }
});

test('history rejects noncanonical, repeated and unbounded pagination without reads',async()=>{
 for(const page of ['0','-1','1.5','01','1e2',' 1','',null,['1','2'],100001,Infinity]){const f=fixture();await assert.rejects(()=>f.service.clientHistory(A,{page}),error=>error.getStatus()===400);assert.deepEqual(f.calls,[]);}
 for(const pageSize of [10,100,'20.0','020','',null,['20','50']]){const f=fixture();await assert.rejects(()=>f.service.clientHistory(A,{pageSize}),error=>error.getStatus()===400);assert.deepEqual(f.calls,[]);}
});

test('20/50 pagination is deterministic, clamps and counts orders once despite duplicate item observations',async()=>{
 const f=fixture();for(const o of f.orders)o.items=Array.from({length:4},()=>({...o.items[0]}));
 const pages=await Promise.all(['1','2','3'].map(page=>f.service.clientHistory(A,{page,pageSize:'20'})));
 assert.deepEqual(pages.map(p=>p.items.length),[20,20,5]);assert.equal(new Set(pages.flatMap(p=>p.items.map(o=>o.id))).size,45);assert.ok(pages.every(p=>p.total===45&&p.summary.total===p.summary.completed+p.summary.inProgress+p.summary.cancelled));
 const large=await f.service.clientHistory(A,{page:'99',pageSize:'50'});assert.equal(large.page,1);assert.equal(large.items.length,45);assert.equal(large.total,45);
 f.orders[0].createdAt=new Date('2030-01-01');const newest=await f.service.clientHistory(A);assert.equal(newest.items[0].id,'000');assert.equal(newest.items[1].id,'044');
});

test('every known sales status and unknown future statuses map to exactly one summary bucket',async()=>{
 const statuses=[...Object.values(require('@prisma/client').SalesStatus),'UNKNOWN_STATUS_FROM_NEWER_VERSION'];
 for(const status of statuses){const f=fixture();f.orders.splice(0,f.orders.length,makeOrder('only-order',A,status));const actual=(await f.service.clientHistory(A)).summary;assert.deepEqual(actual,status==='COMPLETED'?{total:1,completed:1,inProgress:0,cancelled:0}:status==='CANCELLED'?{total:1,completed:0,inProgress:0,cancelled:1}:{total:1,completed:0,inProgress:1,cancelled:0},status);}
});

test('absent client query preserves read-model defaults and does not add lookup or metadata',async()=>{
 const {normalizeOrderListRead}=loadTargetModule('orders/order-list-read-model.ts');assert.deepEqual(normalizeOrderListRead({}),{focusId:undefined,source:'',page:1,pageSize:20,quick:'all',status:'all',discipline:'all',sort:'created',direction:'desc'});
 const f=fixture();await f.service.list();assert.equal(f.calls.some(c=>c.kind==='client'),false);assert.equal(f.calls.some(c=>c.kind==='transaction'),false);
 const page=await f.service.list(undefined,{page:'1',pageSize:'20'});assert.equal('clientFilter'in page,false);assert.equal(f.calls.some(c=>c.kind==='client'),false);
});

test('history controller is GET before generic detail and inherits session plus exact OWNER ADMIN MANAGER guards',async()=>{
 const {OrdersController}=loadTargetModule('orders/orders.controller.ts'),{RolesGuard}=loadTargetModule('auth/roles.guard.ts'),{SessionGuard}=loadTargetModule('auth/session.guard.ts'),{Reflector}=require('@nestjs/core');
 const handler=OrdersController.prototype.clientHistory;assert.equal(Reflect.getMetadata('path',handler),'client-history/:clientId');assert.equal(Reflect.getMetadata('method',handler),0);assert.deepEqual(Reflect.getMetadata('roles',handler),['OWNER','ADMIN','MANAGER']);assert.deepEqual(Reflect.getMetadata('__guards__',OrdersController),[SessionGuard,RolesGuard]);
 const methods=Object.getOwnPropertyNames(OrdersController.prototype);assert.ok(methods.indexOf('clientHistory')<methods.indexOf('detail'));
 const guard=new RolesGuard(new Reflector());for(const role of ['OWNER','ADMIN','MANAGER','PRODUCTION','ACCOUNTANT','SEAMSTRESS','CUTTER',undefined]){const ctx={getHandler:()=>handler,getClass:()=>OrdersController,switchToHttp:()=>({getRequest:()=>({user:role?{role}:undefined})})};if(['OWNER','ADMIN','MANAGER'].includes(role))assert.equal(guard.canActivate(ctx),true);else assert.throws(()=>guard.canActivate(ctx),error=>error.getStatus()===403);}
 const {UnauthorizedException}=require('@nestjs/common'),session=new SessionGuard({userForToken:async token=>{if(!token)throw new UnauthorizedException();return{id:A,role:'OWNER'};}});await assert.rejects(()=>session.canActivate({switchToHttp:()=>({getRequest:()=>({cookies:{}})})}),error=>error.getStatus()===401);
 const forwarded=[];const controller=new OrdersController({clientHistory:async(...args)=>forwarded.push(args)});await controller.clientHistory(A,'2','50');assert.deepEqual(forwarded,[[A,{page:'2',pageSize:'50'}]]);
});
