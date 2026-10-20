import test from 'node:test';
import assert from 'node:assert/strict';
import { createParentMeasurementsApi } from '../lib/parent-measurements-api.ts';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const native=createRequire(import.meta.url);
const load = path => { const module={exports:{}}; new Function('module','exports','require',ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(module,module.exports,name=>name==='./i18n'?load(new URL('../lib/i18n.ts',import.meta.url)):native(name)); return module.exports; };
const {parentMeasurementsCopy,localeDirection}=load(new URL('../lib/parent-measurements-i18n.ts',import.meta.url));

test('public API uses same-origin cookies, no-store and CSRF; draft values remain pure cm', async()=>{
  const calls=[];
  const api=createParentMeasurementsApi(async(url,init)=>{calls.push({url,init});return Response.json(url.endsWith('/start')?{csrfToken:'csrf',children:[]}:{id:'child',revision:2});});
  assert.equal(calls.length,0);
  await api.start('secret','it');
  await api.save('child',1,{firstName:'Éva',discipline:'FIGURE_SKATING',measuredAt:'2026-10-19',values:{m1:70.5},units:'in'});
  assert.equal(calls[1].init.credentials,'same-origin');assert.equal(calls[1].init.cache,'no-store');
  assert.equal(calls[1].init.headers['X-PM-CSRF'],'csrf');
  assert.deepEqual(JSON.parse(calls[1].init.body),{revision:1,draft:{firstName:'Éva',discipline:'FIGURE_SKATING',measuredAt:'2026-10-19',values:{m1:70.5},units:'in'}});
  assert.equal(calls.some(call=>call.url.includes('secret')),false);
});

test('server errors never leak raw messages; private photos use authenticated blob reads',async()=>{
  const bad=createParentMeasurementsApi(async()=>Response.json({message:'private@example.test'},{status:403}));
  await assert.rejects(bad.resume(),error=>error.status===403&&!error.message.includes('@'));
  let request;
  const api=createParentMeasurementsApi(async(url,init)=>{request={url,init};return new Response(new Blob(['photo'],{type:'image/jpeg'}));});
  const photo=await api.photo('own-child');assert.equal(photo.type,'image/jpeg');assert.equal(request.init.credentials,'same-origin');assert.equal(request.init.cache,'no-store');
  assert.equal(request.url,'/api/public/parent-measurements/photos/own-child');
});

test('start, recover and resume retain trusted policy and saving carries versioned exact warning codes',async()=>{
  const ranges={version:'00000000-0000-4000-8000-000000000001',rules:[{id:'test',field:1,lowerCm:60,upperCm:80}]};
  const calls=[];
  const api=createParentMeasurementsApi(async(url,init)=>{calls.push({url,init});return Response.json({csrfToken:'csrf',children:[],ranges});});
  assert.deepEqual((await api.start('token','en')).ranges,ranges);
  assert.deepEqual((await api.recover('recovery')).ranges,ranges);
  assert.deepEqual((await api.resume()).ranges,ranges);
  const code=`${ranges.version}:test:m1:180`;
  await api.save('own-child',0,{firstName:'Test',values:{m1:90},rangeVersion:ranges.version,warningsAcknowledged:[code]});
  assert.deepEqual(JSON.parse(calls.at(-1).init.body).draft,{firstName:'Test',values:{m1:90},rangeVersion:ranges.version,warningsAcknowledged:[code]});
});

test('all six dictionaries cover every action, canonical 17 fields and six CRM disciplines; Arabic direction is ready',()=>{
  const keys=Object.keys(parentMeasurementsCopy.ru).sort();
  for(const ui of Object.values(parentMeasurementsCopy)){
    assert.deepEqual(Object.keys(ui).sort(),keys);
    assert.equal(ui.fields.length,17);assert.equal(ui.sports.length,6);
    assert.equal(ui.fields.every(label=>typeof label==='string'&&label.trim().length>0),true);
    for(const value of Object.values(ui)) if(typeof value==='string')assert.ok(value.trim());
  }
  assert.equal(localeDirection('ar-SA'),'rtl');assert.equal(localeDirection('fr'),'ltr');
});
