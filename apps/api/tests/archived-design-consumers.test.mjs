import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {productionOrderSelect}=loadTargetModule('orders/production-context.ts');
const {orderListCandidateSelect,buildOrderListPage}=loadTargetModule('orders/order-list-read-model.ts');
const {overviewOrderSourceSelect,classifyOverviewOrder}=loadTargetModule('overview/overview-order-model.ts');
const {shippingEvidence}=loadTargetModule('orders/order-shipping-evidence.ts');
const active={id:'active',archivedAt:null,name:'Active',quantity:2,productionStatus:'SEWING',instances:[{id:'a',archivedAt:null,productionStatus:'SEWING'},{id:'b',archivedAt:null,productionStatus:'SEWING'}]};
const archived={id:'historical',archivedAt:new Date('2026-10-01'),name:'Archived',quantity:99,productionStatus:'READY',instances:[{id:'historical-piece',archivedAt:null,productionStatus:'READY'}]};
const order={id:'o',number:'O',createdAt:new Date('2026-10-01'),type:'CUSTOM_ORDER',sourceSystem:null,client:{displayName:'Synthetic'},currency:'EUR',priceMinor:10000,depositRequiredMinor:5000,paymentStatus:'UNPAID',salesStatus:'IN_PRODUCTION',productionStatus:'SEWING',shippingStatus:'NOT_READY',payments:[],items:[active,archived],orderShipments:[{status:'SHIPPED',trackingNumber:'SYNTHETIC',instances:[{id:'a'},{id:'b'}]}],shipment:null,deadlineEvidence:[]};
// Apply the actual narrow select/where to synthetic records like the repository does.
function project(row,select){return Object.fromEntries(Object.entries(select).filter(([key])=>key in row).map(([key,value])=>[key,value===true?row[key]:row[key]==null?row[key]:Array.isArray(row[key])?row[key].filter(item=>value.where?.archivedAt===null?!item.archivedAt:true).map(item=>project(item,value.select)):project(row[key],value.select)]));}
for(const [name,select] of [['Orders candidate',orderListCandidateSelect],['Production',productionOrderSelect],['Overview',overviewOrderSourceSelect]])test(name+' excludes archived designs from active quantity and dispatch coverage',()=>{
 const result=project(order,select);assert.equal(result.items.length,1);assert.equal(result.items.reduce((sum,item)=>sum+item.quantity,0),2);assert.equal(shippingEvidence(result).complete,true);
});
test('direct shipping evidence ignores archived design membership without erasing its record',()=>{
 assert.equal(shippingEvidence(order).complete,true);assert.equal(order.items[1].id,'historical');assert.equal(order.items[1].quantity,99);
});

test('managed empty orders leave operational cohorts while legacy no-items and monetary total remain intact',async()=>{
 const {loadProductionOrders}=loadTargetModule('orders/production-context.ts');
 for(const evidence of [{compositionOperations:[{id:'op'}]},{_count:{items:1}}]){
  const managed={...order,items:[],orderShipments:[],requiredDeliveryAt:new Date('2026-10-01'),...evidence};
  const now=new Date('2026-10-15');const page=buildOrderListPage([managed],{},now);
  assert.equal(page.metrics.work,0);assert.equal(page.metrics.overdue,0);assert.equal(page.items[0].priceMinor,10000);
  assert.equal(classifyOverviewOrder(managed,now).work,false);
  assert.deepEqual(await loadProductionOrders({findMany:async()=>[managed],findFirst:async()=>managed}),[]);
 }
 const legacy={...order,items:[],orderShipments:[],compositionOperations:[],_count:{items:0}};
 assert.equal(buildOrderListPage([legacy],{},new Date()).metrics.work,1);
 assert.equal(classifyOverviewOrder(legacy,new Date()).work,true);
});

test('Production public projection strips private composition existence records',async()=>{
 const {loadProductionOrders}=loadTargetModule('orders/production-context.ts');
 const record={...order,items:[active],compositionOperations:[{id:'private-operation'}],_count:{items:1}};
 const [result]=await loadProductionOrders({findMany:async()=>[record],findFirst:async()=>null});
 assert.equal('compositionOperations' in result,false);assert.equal('_count' in result,false);
 assert.equal(result.items.length,1);
});
