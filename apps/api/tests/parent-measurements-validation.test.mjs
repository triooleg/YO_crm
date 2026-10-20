import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {ParentMeasurementsValidationPipe}=loadTargetModule('parent-measurements/parent-measurements-validation.pipe.ts');
const {ParentStartDto,ParentSaveDto}=loadTargetModule('parent-measurements/parent-measurements.dto.ts');
const {CreateMeasurementDto}=loadTargetModule('clients/clients.dto.ts');
test('global public validation rejects unknown fields before legacy whitelist, old DTO behavior remains compatible',async()=>{
 const pipe=new ParentMeasurementsValidationPipe();
 await assert.rejects(pipe.transform({token:'a'.repeat(43),consent:true,locale:'en',clientId:'foreign'},{type:'body',metatype:ParentStartDto}));
 await assert.rejects(pipe.transform({revision:0,draft:{firstName:'A'},athleteId:'foreign'},{type:'body',metatype:ParentSaveDto}));
 const old=await pipe.transform({measuredAt:'2026-10-18',m1:70,m2:56,m3:72,m15:122,legacyExtra:'ignored'},{type:'body',metatype:CreateMeasurementDto});assert.equal(old.legacyExtra,undefined);assert.equal(old.m1,70);
});
