import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './website-test-loader.mjs';
const {classifyOrderSource}=loadTargetModule('orders/order-source.ts');
test('direct imported website identity classifies as website without changing manual provenance',()=>{
 assert.equal(classifyOrderSource({sourceSystem:'YOLEOTARD_WEBSITE',sourceAccount:'calendar.yoleotard.com',externalId:'123',sourceLinkMode:'IMPORTED',externalData:{contractVersion:1}}),'WEBSITE');
 assert.equal(classifyOrderSource({activities:[{type:'ORDER_CREATED'}]}),'MANUAL');
});
