import assert from 'node:assert/strict';
import test from 'node:test';
import {orderCostumeQuantity,orderAssignedAthleteCount,orderDesignCount,orderDesignImagePaths} from '../lib/order-composition-view.ts';

test('website HTTPS images display without resurrecting archived or managed-empty designs',()=>{
 const image='https://website.example/design.png';
 const website={sourceSystem:'YOLEOTARD_WEBSITE',items:[{id:'a',quantity:1,externalImageUrl:image}],externalImageUrl:image};
 assert.deepEqual(orderDesignImagePaths(website),[image]);
 assert.deepEqual(orderDesignImagePaths({...website,items:[]}),[image]);
 assert.deepEqual(orderDesignImagePaths({...website,compositionManaged:true,items:[]}),[]);
 assert.deepEqual(orderDesignImagePaths({...website,items:[{...website.items[0],archivedAt:'2026-10-20'}]}),[]);
 assert.deepEqual(orderDesignImagePaths({...website,items:[{...website.items[0],modelImagePath:'staff.jpg'}]}),['/api/orders/images/staff.jpg']);
 assert.deepEqual(orderDesignImagePaths({...website,items:[{id:'external',quantity:1,externalImageUrl:image},{id:'local',quantity:1,modelImagePath:'staff.jpg'}]}),['/api/orders/images/staff.jpg',image]);
 for(const sourceSystem of ['KEYCRM','OTHER',undefined])assert.deepEqual(orderDesignImagePaths({...website,sourceSystem}),[]);
 for(const externalImageUrl of ['http://website.example/a','javascript:alert(1)','//website.example/a','https://user:password@website.example/a','invalid'])assert.deepEqual(orderDesignImagePaths({...website,items:[{quantity:1,externalImageUrl}],externalImageUrl}),[]);
});
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
