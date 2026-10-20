import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),ts=require('typescript');
function load(){const mod={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(new URL('../components/orders/measurements-wizard-request.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>name==='../../lib/i18n'?{parentMeasurementsStaffUi:{error:'error',manualUncertain:'uncertain',manualChangedWhileUnknown:'changed'}}:require(name),mod,mod.exports);return mod.exports;}
test('order wizard retries a lost create with the same route and exact command despite its regenerated timestamp',async()=>{
 const {createOrderMeasurementsWizardRequest}=load();const writes=[];let fail=true;
 const request=createOrderMeasurementsWizardRequest('o1','c1',async(path,init)=>{writes.push({path,body:JSON.parse(init.body)});if(fail){fail=false;throw Error('lost');}return{id:'snapshot'};});
 await assert.rejects(request('/clients/c1/athletes/a1/measurements',{method:'POST',body:JSON.stringify({measuredAt:'2026-10-19T12:00:00Z',m1:60,m2:50,m3:65,m15:110})}));
 await request('/clients/c1/athletes/a1/measurements',{method:'POST',body:JSON.stringify({measuredAt:'2026-10-19T12:00:01Z',m1:60,m2:50,m3:65,m15:110})});
 assert.equal(writes[0].path,'/order-tabs/o1/athletes/a1/measurements');assert.deepEqual(writes[0],writes[1]);assert.ok(writes[0].body.operationKey.length>=16);
});
test('wizard blocks foreign clients and edited commands while a previous result is unknown',async()=>{
 const {createOrderMeasurementsWizardRequest}=load();const writes=[];const request=createOrderMeasurementsWizardRequest('o1','c1',async(path,init)=>{writes.push(path);throw Error('lost');});
 await assert.rejects(request('/clients/c2/athletes',{method:'POST',body:'{"firstName":"Анна"}'}));assert.equal(writes.length,0);
 await assert.rejects(request('/clients/c1/athletes',{method:'POST',body:'{"firstName":"Анна"}'}));
 await assert.rejects(request('/clients/c1/athletes',{method:'POST',body:'{"firstName":"София"}'}));assert.equal(writes.length,1);
});

test('wizard confirms sport before creating and cannot issue a second create while consent is pending',async()=>{
 const {createOrderMeasurementsWizardRequest}=load();let confirm,writes=0;
 const request=createOrderMeasurementsWizardRequest('o1','c1',async()=>{writes++;return{id:'a1'};},()=>new Promise(resolve=>{confirm=resolve;}));
 const first=request('/clients/c1/athletes',{method:'POST',body:'{"firstName":"Анна","discipline":"OTHER"}'});
 await assert.rejects(request('/clients/c1/athletes',{method:'POST',body:'{"firstName":"Анна","discipline":"OTHER"}'}));
 confirm(true);await first;assert.equal(writes,1);
});

test('explicit measurement date remains part of manual operation identity',async()=>{
 const{createOrderMeasurementsWizardRequest}=load();const writes=[];let fail=true;
 const request=createOrderMeasurementsWizardRequest('o1','c1',async(path,init)=>{writes.push(JSON.parse(init.body));if(fail){fail=false;throw Error('lost');}return{id:'m'};},undefined,true);
 const body={measuredAt:'2026-10-19T00:00:00.000Z',m1:60,m2:50,m3:65,m15:110,notes:'Снимок'};
 await assert.rejects(request('/clients/c1/athletes/a1/measurements',{method:'POST',body:JSON.stringify(body)}));
 await assert.rejects(request('/clients/c1/athletes/a1/measurements',{method:'POST',body:JSON.stringify({...body,measuredAt:'2026-10-18T00:00:00.000Z'})}));
 assert.equal(writes.length,1);await request('/clients/c1/athletes/a1/measurements',{method:'POST',body:JSON.stringify(body)});assert.deepEqual(writes[0],writes[1]);
});
