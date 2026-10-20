import assert from 'node:assert/strict';
import test from 'node:test';
import { orderSettlement } from '../lib/order-settlement.mjs';
const order={priceMinor:10000,currency:'EUR',payments:[]};
test('settlement distinguishes zero receipts, real applied evidence and unknown',()=>{
 assert.deepEqual(orderSettlement(order),{paidMinor:0,balanceMinor:10000});
 assert.deepEqual(orderSettlement({...order,payments:undefined}),{paidMinor:null,balanceMinor:null});
 for(const payment of [{amountMinor:2000,currency:'EUR'},{amountMinor:3000,currency:'USD',appliedAmountMinor:2000,appliedCurrency:'EUR'}]) assert.deepEqual(orderSettlement({...order,payments:[payment]}),{paidMinor:2000,balanceMinor:8000});
 for(const payment of [{amountMinor:3000,currency:'USD'},{amountMinor:3000,currency:'USD',appliedAmountMinor:2000,appliedCurrency:'USD'},{amountMinor:NaN,currency:'EUR'}]) assert.deepEqual(orderSettlement({...order,payments:[payment]}),{paidMinor:null,balanceMinor:null});
 assert.deepEqual(orderSettlement({...order,payments:[{amountMinor:3000,currency:'USD',voidedAt:'2026-10-01'}]}),{paidMinor:0,balanceMinor:10000});
 assert.equal(orderSettlement({...order,payments:[{amountMinor:Number.MAX_SAFE_INTEGER,currency:'EUR'},{amountMinor:1,currency:'EUR'}]}).paidMinor,null);
});
