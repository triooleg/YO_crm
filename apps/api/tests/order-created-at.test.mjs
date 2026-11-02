import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {loadTargetModule} from './website-test-loader.mjs';
const require=createRequire(import.meta.url);
const {validateSync}=require('class-validator');
const {Reflector}=require('@nestjs/core');
const {OrdersService}=loadTargetModule('orders/orders.service.ts');
const {OrdersController}=loadTargetModule('orders/orders.controller.ts');
const {RolesGuard}=loadTargetModule('auth/roles.guard.ts');
const dto=loadTargetModule('orders/orders.dto.ts');
const initial={id:'o1',clientId:'c1',number:'26-100',createdAt:new Date('2026-10-20T10:11:12.123Z'),archivedAt:null,paymentStatus:'DEPOSIT_PAID',productionStatus:'IN_PROGRESS',shippingStatus:'NOT_SHIPPED'};
const command={createdAt:'2025-03-02T10:11:12.123Z',expectedCreatedAt:initial.createdAt.toISOString()};
function fixture(){
 const state={order:structuredClone(initial),audits:[],activities:[],writes:[],reads:0,invalidations:0};
 const tx={$executeRawUnsafe:async()=>{},order:{findFirst:async()=>{state.reads++;return state.order.archivedAt?null:state.order;},updateMany:async({where,data})=>{if(state.order.createdAt.getTime()!==where.createdAt.getTime())return{count:0};state.writes.push(data);Object.assign(state.order,data);return{count:1};}},activity:{create:async({data})=>state.activities.push(data)},auditLog:{create:async({data})=>state.audits.push(data)}};
 const prisma={$transaction:async callback=>{const before=structuredClone(state);try{return await callback(tx)}catch(e){Object.assign(state,before);throw e}}};
 return{state,tx,service:new OrdersService(prisma,undefined,undefined,{invalidate:()=>{state.invalidations++}})};
}
test('created date edits only createdAt, preserves order number and records before/after atomically',async()=>{
 const {state,service}=fixture();const saved=await service.updateCreatedAt('o1',command,{id:'u1',role:'MANAGER'});
 assert.equal(saved.createdAt.toISOString(),command.createdAt);assert.equal(state.order.number,'26-100');assert.equal(state.order.paymentStatus,'DEPOSIT_PAID');assert.equal(state.order.productionStatus,'IN_PROGRESS');assert.equal(state.order.shippingStatus,'NOT_SHIPPED');
 assert.equal(state.invalidations,1);assert.deepEqual(Object.keys(state.writes[0]),['createdAt']);assert.equal(state.activities[0].type,'ORDER_CREATED_AT_UPDATED');assert.deepEqual(state.audits[0].before,{createdAt:command.expectedCreatedAt});assert.deepEqual(state.audits[0].after,{createdAt:command.createdAt});assert.equal(state.audits[0].actorId,'u1');
});
test('invalid or impossible dates fail before DB access and DTO rejects date-only, offsets, missing values',async()=>{
 assert.equal(typeof dto.UpdateOrderCreatedAtDto,'function');
 for(const value of ['2026-02-30T10:11:12.123Z','2026-10-01','2026-10-01T10:00:00+03:00','bad','0000-01-01T00:00:00.000Z',null,42,undefined]){
  const {service,state}=fixture();await assert.rejects(()=>service.updateCreatedAt('o1',{...command,createdAt:value},{id:'u1',role:'OWNER'}),e=>e.getStatus()===400);assert.equal(state.reads,0);
  assert.ok(validateSync(Object.assign(new dto.UpdateOrderCreatedAtDto(),{...command,createdAt:value})).length);
 }
 assert.equal(validateSync(Object.assign(new dto.UpdateOrderCreatedAtDto(),command)).length,0);
});
test('stale or archived orders do not mutate and repeated same date is a no-op',async()=>{
 const {state,service}=fixture();await assert.rejects(()=>service.updateCreatedAt('o1',{...command,expectedCreatedAt:'2026-10-19T10:11:12.123Z'},{id:'u1',role:'OWNER'}),e=>e.getStatus()===409);
 await service.updateCreatedAt('o1',{createdAt:command.expectedCreatedAt,expectedCreatedAt:command.expectedCreatedAt},{id:'u1',role:'OWNER'});assert.equal(state.writes.length,0);assert.equal(state.audits.length,0);
 state.order.archivedAt=new Date();await assert.rejects(()=>service.updateCreatedAt('o1',command,{id:'u1',role:'OWNER'}),e=>e.getStatus()===404);assert.equal(state.activities.length,0);
});
test('created date endpoint and service enforce OWNER ADMIN MANAGER',async()=>{
 const handler=OrdersController.prototype.updateCreatedAt;assert.equal(typeof handler,'function');assert.deepEqual(Reflect.getMetadata('roles',handler),['OWNER','ADMIN','MANAGER']);
 const guard=new RolesGuard(new Reflector());
 for(const role of ['OWNER','ADMIN','MANAGER','ACCOUNTANT','PRODUCTION','SEAMSTRESS','CUTTER','']){
  const context={getHandler:()=>handler,getClass:()=>OrdersController,switchToHttp:()=>({getRequest:()=>({user:{id:'u1',role}})})};const {service,state}=fixture();
  if(['OWNER','ADMIN','MANAGER'].includes(role)){assert.equal(guard.canActivate(context),true);await service.updateCreatedAt('o1',command,{id:'u1',role});}
  else{assert.throws(()=>guard.canActivate(context),e=>e.getStatus()===403);await assert.rejects(()=>service.updateCreatedAt('o1',command,{id:'u1',role}),e=>e.getStatus()===403);assert.equal(state.reads,0);}
 }
});

test('audit failure rolls back the created date and conflict during write leaves history empty',async()=>{
 const {service,state,tx}=fixture();tx.auditLog.create=async()=>{throw Error('AUDIT_UNAVAILABLE')};
 await assert.rejects(()=>service.updateCreatedAt('o1',command,{id:'u1',role:'OWNER'}),/AUDIT_UNAVAILABLE/);assert.equal(state.order.createdAt.toISOString(),initial.createdAt.toISOString());assert.equal(state.activities.length,0);assert.equal(state.invalidations,0);
 const raced=fixture();raced.tx.order.updateMany=async()=>({count:0});await assert.rejects(()=>raced.service.updateCreatedAt('o1',command,{id:'u1',role:'OWNER'}),e=>e.getStatus()===409);assert.equal(raced.state.audits.length,0);assert.equal(raced.state.activities.length,0);
});
