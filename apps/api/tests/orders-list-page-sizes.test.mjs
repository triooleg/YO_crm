import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {normalizeOrderListRead,buildOrderListPage}=loadTargetModule('orders/order-list-read-model.ts');
const {normalizeClientHistoryPage}=loadTargetModule('orders/order-client-history.ts');

test('main Orders list accepts exactly 20/30/50/70/100 with default 20',()=>{
 assert.equal(normalizeOrderListRead({}).pageSize,20);
 for(const pageSize of [20,30,50,70,100,'20','30','50','70','100'])assert.equal(normalizeOrderListRead({pageSize}).pageSize,Number(pageSize));
});

test('unsupported main list sizes still fail with 400',()=>{
 for(const pageSize of [0,1,10,25,40,60,80,90,200,-30,30.5,70.5,Infinity,NaN,'not-a-size',''])assert.throws(()=>normalizeOrderListRead({pageSize}),e=>e.getStatus()===400,String(pageSize));
});

test('30/70 page slicing uses the requested page and does not change facets',()=>{
 const records=Array.from({length:71},(_,i)=>({id:'order-'+i,number:'YO-'+i,createdAt:new Date('2026-01-01'),client:{displayName:'Synthetic'},items:[{quantity:1}],payments:[],currency:'EUR',priceMinor:100,depositRequiredMinor:0,salesStatus:'NEW_LEAD',productionStatus:'NOT_SCHEDULED',shippingStatus:'NOT_READY',orderSource:'MANUAL'}));
 for(const[pageSize,page,lastSize]of [[30,3,11],[70,2,1]]){const first=buildOrderListPage(records,{pageSize,page:1}),last=buildOrderListPage(records,{pageSize,page});assert.equal(first.items.length,pageSize);assert.equal(last.items.length,lastSize);assert.equal(first.metrics.total,71);assert.equal(last.metrics.total,71);assert.equal(last.page,page);assert.equal(last.pageSize,pageSize);assert.equal(last.total,71);}
});

test('separate client-history modal API remains default20 and accepts only20/50',()=>{
 assert.deepEqual(normalizeClientHistoryPage({}),{page:1,pageSize:20});for(const pageSize of [20,50,'20','50'])assert.equal(normalizeClientHistoryPage({pageSize}).pageSize,Number(pageSize));for(const pageSize of [30,70,100,'30','70','100'])assert.throws(()=>normalizeClientHistoryPage({pageSize}),e=>e.getStatus()===400);
});
