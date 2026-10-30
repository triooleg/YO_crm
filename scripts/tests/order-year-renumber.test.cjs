const test=require('node:test'),assert=require('node:assert/strict');
const {buildPlan,digest,applyPlan,rollbackPlan}=require('../order-year-renumber.cjs');
const row=(id,number,createdAt='2024-06-01T00:00:00Z')=>({id,clientId:'client-'+id,number,createdAt:new Date(createdAt),updatedAt:new Date('2026-10-30T00:00:00Z'),archivedAt:null,sourceSystem:null,externalNumber:null,externalId:null});
const context={databaseFingerprint:'a'.repeat(64),generatedAt:'2026-10-30T00:00:00.000Z'};
function database(records){
 const state={orders:structuredClone(records),audits:[],activities:[],invoices:[{number:'INV',dataSnapshot:{orderNumber:'YO-671'}}]};
 const db={$transaction:async fn=>{const before=structuredClone(state);try{return await fn(tx)}catch(e){Object.assign(state,before);throw e}}};
 const tx={$executeRawUnsafe:async()=>{},user:{findFirst:async()=>({id:'owner'})},order:{findMany:async()=>structuredClone(state.orders),updateMany:async({where,data})=>{const found=state.orders.find(r=>r.id===where.id&&r.number===where.number&&new Date(r.updatedAt).getTime()===new Date(where.updatedAt).getTime());if(!found)return{count:0};Object.assign(found,data,{updatedAt:new Date(new Date(found.updatedAt).getTime()+1)});return{count:1}}},activity:{create:async({data})=>state.activities.push(data)},auditLog:{create:async({data})=>state.audits.push(data),findMany:async()=>state.audits}};
 return {db,state,tx};
}
test('literal prefix only, Kyiv creation year, archived included, non-YO retained and lifetime counter floor',()=>{
 const records=[row('a','YO-671','2023-12-31T22:30:00Z'),row('b','YO-26-0001','2026-01-01T00:00:00Z'),{...row('c','YO-800'),archivedAt:new Date()},row('d','WEB-20'),row('e','KC-900')];
 const p=buildPlan(records,context);assert.equal(p.status,'READY');assert.deepEqual(p.rows.map(r=>[r.id,r.newNumber]),[['a','24-671'],['b','26-26-0001'],['c','24-800']]);assert.equal(p.unchanged,2);assert.equal(p.counterFloor,900);assert.equal(p.rows[0].oldNumber,'YO-671');assert.ok(p.rows.every(r=>r.updatedAt&&r.createdAt));
});
test('collision against unchanged archived rows and unknown YO formats block entire plan',()=>{
 assert.equal(buildPlan([row('a','YO-1'),{...row('b','24-1'),archivedAt:new Date()}],context).status,'BLOCKED');
 assert.equal(buildPlan([row('a','YO-custom')],context).status,'BLOCKED');
});
test('hash, snapshot drift and missing backup confirmation fail before writes',async()=>{
 const f=database([row('a','YO-671')]),p=buildPlan(f.state.orders,context),options={actorId:'owner',databaseFingerprint:context.databaseFingerprint,expectedHash:digest(p),backupReceiptSha256:'b'.repeat(64),backupDrillConfirmed:true};
 await assert.rejects(()=>applyPlan(f.db,p,{...options,expectedHash:'0'.repeat(64)}));await assert.rejects(()=>applyPlan(f.db,p,{...options,backupDrillConfirmed:false}));f.state.orders[0].updatedAt=new Date('2026-10-31T00:00:00Z');await assert.rejects(()=>applyPlan(f.db,p,options));assert.deepEqual(f.state.audits,[]);assert.equal(f.state.orders[0].number,'YO-671');
});
test('atomic audited apply changes only numbers; rollback preserves concurrent unrelated edits/new orders and is idempotent',async()=>{
 const f=database([row('a','YO-671'),row('b','YO-26-0001','2026-01-01')]),p=buildPlan(f.state.orders,context),options={actorId:'owner',databaseFingerprint:context.databaseFingerprint,expectedHash:digest(p),backupReceiptSha256:'b'.repeat(64),backupDrillConfirmed:true};
 const before=structuredClone(f.state.invoices),receipt=await applyPlan(f.db,p,options);assert.equal(f.state.orders[0].number,'24-671');assert.equal(f.state.audits.length,2);assert.equal(f.state.activities[0].metadata.oldNumberSearch,'YO-671');assert.deepEqual(f.state.invoices,before);
 assert.equal((await applyPlan(f.db,p,options)).idempotentReplay,true);assert.equal(f.state.audits.length,2);
 f.state.orders[0].notes='Concurrent edit must survive';f.state.orders[0].updatedAt=new Date('2026-11-01');f.state.orders.push(row('new','26-900'));
 const result=await rollbackPlan(f.db,p,receipt,{...options,receiptHash:digest(receipt)});assert.equal(result.status,'ROLLED_BACK');assert.equal(f.state.orders[0].number,'YO-671');assert.equal(f.state.orders[0].notes,'Concurrent edit must survive');assert.equal(f.state.orders.at(-1).number,'26-900');assert.deepEqual(f.state.invoices,before);
 assert.equal((await rollbackPlan(f.db,p,receipt,{...options,receiptHash:digest(receipt)})).status,'ALREADY_ROLLED_BACK');
});
test('synthetic owner population is bounded and preserves all 509 YO suffixes with 2 unchanged records',()=>{
 const records=Array.from({length:506},(_,i)=>row('n'+String(i).padStart(3,'0'),'YO-'+(i+4),'2024-06-01'));for(let i=1;i<=3;i++)records.push(row('compound'+i,'YO-26-000'+i,'2026-01-01'));records.push(row('web','WEB-2'),row('kc','KC-3'));
 const p=buildPlan(records,context);assert.equal(p.total,511);assert.equal(p.rows.length,509);assert.equal(p.unchanged,2);assert.equal(p.status,'READY');assert.equal(p.counterFloor,509);assert.ok(p.rows.every(r=>r.newNumber.slice(3)===r.oldNumber.slice(3)));
});
test('rollback rejects concurrent number changes and collisions without partial writes',async()=>{
 const f=database([row('a','YO-671')]),p=buildPlan(f.state.orders,context),o={actorId:'owner',databaseFingerprint:context.databaseFingerprint,expectedHash:digest(p),backupReceiptSha256:'b'.repeat(64),backupDrillConfirmed:true};const receipt=await applyPlan(f.db,p,o);f.state.orders.push(row('other','YO-671'));await assert.rejects(()=>rollbackPlan(f.db,p,receipt,{...o,receiptHash:digest(receipt)}));assert.equal(f.state.orders[0].number,'24-671');
});
