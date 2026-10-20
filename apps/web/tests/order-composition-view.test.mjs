import assert from 'node:assert/strict';
import test from 'node:test';
import {orderCostumeQuantity,orderAssignedAthleteCount,orderDesignCount,orderDesignImagePaths} from '../lib/order-composition-view.ts';
test('six physical assignments count six people while identical design duplicates remain two designs',()=>{
 const order={items:[{id:'a',name:'same',quantity:3,modelImagePath:'same.jpg',instances:[0,1,2].map(n=>({id:String(n),athlete:{id:'a'+n}}))},{id:'b',name:'same',quantity:3,modelImagePath:'same.jpg',instances:[3,4,5].map(n=>({id:String(n),athlete:{id:'a'+n}}))}]};
 assert.equal(orderCostumeQuantity(order),6);assert.equal(orderAssignedAthleteCount(order),6);assert.equal(orderDesignCount(order),2);
 order.items[1].instances[0].athlete={id:'a0'};assert.equal(orderAssignedAthleteCount(order),5);
});
test('managed empty composition has no phantom costume, design or image; true legacy keeps fallback',()=>{
 const managed={compositionManaged:true,modelImagePath:'historical.jpg',items:[]};assert.equal(orderCostumeQuantity(managed),0);assert.equal(orderDesignCount(managed),0);assert.deepEqual(orderDesignImagePaths(managed),[]);
 assert.equal(orderCostumeQuantity({items:[]}),1);assert.equal(orderDesignCount({items:[]}),1);
 const active={compositionManaged:true,modelImagePath:'old.jpg',items:[{id:'d',quantity:1,modelImagePath:'new.jpg'}]};assert.equal(orderDesignImagePaths(active)[0],'/api/orders/images/new.jpg');
});
