import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './website-test-loader.mjs';
const {ClientsService}=loadTargetModule('clients/clients.service.ts');
test('client country uses the existing audited profile transaction and invalidates statistics after commit only',async()=>{
 let client={id:'c1',displayName:'Client',country:'Ukraine',language:'uk',phone:'+380501234567',email:'before@example.invalid',updatedAt:new Date('2026-10-30T10:00:00.000Z')},invalidations=0,fail=false;const audits=[],activities=[];
 const tx={$executeRaw:async()=>{},$queryRaw:async()=>[],client:{findFirst:async()=>structuredClone(client),updateMany:async({data})=>{client={...client,...data,updatedAt:new Date('2026-10-30T10:00:01.000Z')};return{count:1}},findUnique:async()=>client},activity:{create:async({data})=>activities.push(data)},auditLog:{create:async({data})=>{if(fail)throw Error('AUDIT');audits.push(data)}}};
 const db={$transaction:async fn=>{const before=structuredClone(client),a=activities.length;try{return await fn(tx)}catch(e){client=before;activities.length=a;throw e}}};
 const service=new ClientsService(db,{invalidate:()=>invalidations++}),input={displayName:'Client',country:'Poland',expectedUpdatedAt:client.updatedAt.toISOString()};
 await service.updateProfile('c1',input,{id:'owner'});assert.equal(client.country,'Poland');assert.equal(client.phone,'+380501234567');assert.equal(invalidations,1);assert.equal(audits[0].before.country,'Ukraine');assert.equal(audits[0].after.country,'Poland');assert.equal(activities[0].type,'CLIENT_PROFILE_UPDATED');
 await service.updateProfile('c1',{...input,expectedUpdatedAt:client.updatedAt.toISOString()},{id:'owner'});assert.equal(invalidations,1);
 fail=true;await assert.rejects(()=>service.updateProfile('c1',{...input,country:'France',expectedUpdatedAt:client.updatedAt.toISOString()},{id:'owner'}),/AUDIT/);assert.equal(invalidations,1);assert.equal(client.country,'Poland');
});
