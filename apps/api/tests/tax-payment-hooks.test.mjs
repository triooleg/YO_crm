import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {loadTargetModule} from './overview-target-loader.mjs';
const owner={id:'tax-owner',role:'OWNER'};
function fixture(){
 const payment={id:'tax-payment',orderId:'tax-order',amountMinor:1000000,currency:'UAH',receivedAt:new Date('2026-05-01T10:00:00Z'),voidedAt:null};
 const order={id:'tax-order',clientId:'tax-client',type:'ACCESSORY',currency:'UAH',priceMinor:2000000,depositRequiredMinor:1000000,paymentStatus:'PARTIALLY_PAID',updatedAt:new Date('2026-05-01T11:00:00Z'),productionStatus:'NOT_REQUIRED',productionSlot:null,items:[],invoices:[],payments:[]};
 const calls=[];
 const tx={$executeRawUnsafe:async()=>{},order:{findFirst:async()=>order,update:async({data})=>({...order,...data})},payment:{create:async()=>payment,findFirst:async()=>payment,update:async({data})=>({...payment,...data})},activity:{create:async()=>{}},auditLog:{create:async()=>{}}};
 const taxes={capturePayment:async(...args)=>calls.push(args)};
 const {OrdersService}=loadTargetModule('orders/orders.service.ts');
 return {service:new OrdersService({order:{findFirst:async()=>order},$transaction:async fn=>fn(tx)}, {},taxes),payment,order,tx,calls,taxes};
}
test('manual receipt captures tax source in the same transaction without changing original money',async()=>{
 const f=fixture(); const result=await f.service.addPayment(f.order.id,{amountMinor:1000000,currency:'UAH',receivedAt:'2026-05-01T10:00:00Z',method:'BANK_TRANSFER'},owner);
 assert.equal(result.amountMinor,1000000);assert.equal(f.calls.length,1);assert.equal(f.calls[0][0],f.tx);assert.equal(f.calls[0][1],f.payment.id);assert.equal(f.calls[0][3],owner.id);
});
test('manual void retains receipt and atomically records tax lifecycle for review',async()=>{
 const f=fixture();await f.service.voidPayment(f.order.id,f.payment.id,{reason:'Ошибка ввода',expectedOrderUpdatedAt:f.order.updatedAt.toISOString()},owner);
 assert.equal(f.calls.length,1);assert.equal(f.calls[0][1],f.payment.id);assert.match(f.calls[0][2],/VOID/);
});
test('tax capture failure propagates to the transaction caller',async()=>{
 const f=fixture();f.taxes.capturePayment=async()=>{throw new Error('tax audit failed')};
 await assert.rejects(f.service.addPayment(f.order.id,{amountMinor:1000000,currency:'UAH',receivedAt:'2026-05-01T10:00:00Z',method:'BANK_TRANSFER'},owner),/tax audit failed/);
});
