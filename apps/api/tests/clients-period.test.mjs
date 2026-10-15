import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import ts from 'typescript';

const require=createRequire(import.meta.url);require('reflect-metadata');
const modules=new Map();
function load(filename){
 if(modules.has(filename))return modules.get(filename).exports;
 const module={exports:{}};modules.set(filename,module);
 const compiled=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,experimentalDecorators:true}}).outputText;
 const localRequire=name=>name.startsWith('.')&&existsSync(resolve(dirname(filename),name+'.ts'))?load(resolve(dirname(filename),name+'.ts')):require(name);
 new Function('require','module','exports',compiled)(localRequire,module,module.exports);return module.exports;
}
const source=fileURLToPath(new URL('../src/clients/',import.meta.url));
const {ClientsService}=load(resolve(source,'clients.service.ts'));
const {ClientsController}=load(resolve(source,'clients.controller.ts'));
function fixture(records){
 const rows=records||[['before','2026-09-30T23:59:59.999Z'],['first','2026-10-01T00:00:00Z'],['last','2026-10-31T23:59:59.999Z'],['after','2026-11-01T00:00:00Z'],['archived','2026-10-15T12:00:00Z']].map(([id,at])=>({id,displayName:id==='last'?'Boris':'Anna',createdAt:new Date(at),archivedAt:id==='archived'?new Date():null}));
 const reads=[];
 const service=new ClientsService({client:{findMany:async args=>{
  reads.push(args);return rows.filter(row=>(args.where.archivedAt!==null||row.archivedAt===null)&&(!args.where.createdAt||row.createdAt>=args.where.createdAt.gte&&row.createdAt<args.where.createdAt.lt)&&(!args.where.OR||args.where.OR.some(part=>Object.entries(part).some(([key,filter])=>String(row[key]||'').toLowerCase().includes(filter.contains.toLowerCase()))))).slice(0,args.take??rows.length);
 }}});
 return {service,reads};
}
test('client period is a server-side half-open createdAt month, independently combined with contact search',async()=>{
 const {service}=fixture();
 assert.deepEqual((await service.list(undefined,'2026-10')).map(row=>row.id),['first','last']);
 assert.deepEqual((await service.list(' Anna ','2026-10')).map(row=>row.id),['first']);
 assert.deepEqual((await service.list('Anna')).map(row=>row.id),['before','first','after']);
 assert.deepEqual((await service.list()).map(row=>row.id),['before','first','last','after']);
});
test('client period validates before any database read and handles December rollover',async()=>{
 const {service,reads}=fixture();
 for(const period of ['2026-13','2026-1','invalid','2026-10-01',['2026-10']])await assert.rejects(()=>service.list('',period),error=>error.getStatus()===400);
 assert.equal(reads.length,0);
 await service.list(undefined,'2026-12');
 assert.equal(reads[0].where.createdAt.gte.toISOString(),'2026-12-01T00:00:00.000Z');
 assert.equal(reads[0].where.createdAt.lt.toISOString(),'2027-01-01T00:00:00.000Z');
 assert.equal(reads[0].take,1001);
});
const monthlyClients=count=>Array.from({length:count},(_,index)=>({id:`client-${index}`,displayName:`Client ${index}`,createdAt:new Date('2026-10-15T12:00:00Z'),archivedAt:null}));
test('month drilldown returns all 120 clients beyond legacy cap and supports exactly 1000',async()=>{
 for(const count of [120,1000]){
  const {service}=fixture(monthlyClients(count));const clients=await service.list(undefined,'2026-10');
  assert.equal(clients.length,count);assert.equal(clients.at(-1).id,`client-${count-1}`);
 }
 const {service,reads}=fixture(monthlyClients(120));
 assert.equal((await service.list()).length,120);assert.equal(reads[0].take,undefined);
 assert.equal((await service.list(undefined,'')).length,120);
});
test('over 1000 monthly clients rejects explicitly instead of silently returning a partial month',async()=>{
 const {service,reads}=fixture(monthlyClients(1200));
 await assert.rejects(()=>service.list(undefined,'2026-10'),error=>error.getStatus()===400&&/1000/.test(error.message));
 assert.equal(reads.length,1);assert.equal(reads[0].take,1001);
 assert.equal((await service.list('Client 1199','2026-10')).length,1);
});
test('client list controller forwards the independent period parameter and preserves read roles',async()=>{
 const calls=[];const controller=new ClientsController({list:(...args)=>{calls.push(args);return ['ok']}});
 assert.deepEqual(await controller.list('Anna','2026-10'),['ok']);
 assert.deepEqual(calls,[['Anna','2026-10']]);
 assert.deepEqual(Reflect.getMetadata('roles',ClientsController.prototype.list),['OWNER','ADMIN','MANAGER']);
});


test('client detail returns every active order and actual client files',async()=>{
 const orders=Array.from({length:25},(_,index)=>({id:`order-${index}`}));
 const files=[{id:'file-1',name:'Saved document.pdf',path:'file.pdf'}];
 const service=new ClientsService({client:{findFirst:async({include})=>({id:'client',displayName:'Client',athletes:[],workTasks:[],activities:[],orders:orders.slice(0,include.orders.take??orders.length),...(include.files?{files}:{} )})}});
 const detail=await service.detail('client');assert.equal(detail.orders.length,25);assert.equal(detail.files[0].name,'Saved document.pdf');
});
