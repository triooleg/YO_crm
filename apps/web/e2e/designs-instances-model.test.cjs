const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const ts=require('typescript');
// Reuse installed integration dependencies through NODE_PATH; no worker install/build.
require.extensions['.ts']=require.extensions['.tsx']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText,filename);
require.extensions['.css']=()=>{};
const {parseDesignPriceMinor,sizeGroups}=require('../components/orders/designs-instances.tsx');
test('price entry preserves exact cents and refuses unsafe amounts',()=>{
 assert.equal(parseDesignPriceMinor('0,29'),29);
 assert.equal(parseDesignPriceMinor('1109060.06'),110906006);
 assert.equal(parseDesignPriceMinor('90071992547409.91'),Number.MAX_SAFE_INTEGER);
 for(const value of ['90071992547409.92','-1','1.001','1e2','', 'Infinity'])assert.equal(parseDesignPriceMinor(value),null);
});
test('size chips group display only, retaining each physical identity and excluding archived pieces',()=>{
 const item={instances:[{id:'a',ordinal:1,standardHeight:134},{id:'b',ordinal:2,standardHeight:134},{id:'c',ordinal:8,standardHeight:140,archivedAt:'2026-10-15'},{id:'d',ordinal:9}]};
 const groups=sizeGroups(item);
 assert.equal(groups[0][0],'134');assert.deepEqual(groups[0][1].map(x=>x.id),['a','b']);
 assert.equal(groups[1][1][0].id,'d');assert.equal(groups.flatMap(x=>x[1]).some(x=>x.id==='c'),false);
 assert.deepEqual(item.instances.map(x=>x.ordinal),[1,2,8,9]);
});
test('an explicitly managed empty composition has no legacy ghost design',()=>{
 const {expandedOrderItems}=require('../components/orders/order-expanded-tabs.tsx');
 const order={id:'history',items:[],priceMinor:10000,currency:'EUR',productionStatus:'NOT_SCHEDULED',compositionManaged:true};
 assert.deepEqual(expandedOrderItems(order),[]);
 assert.equal(expandedOrderItems({...order,compositionManaged:false}).length,1);
});


test('expanded-tab product quantity excludes archived items and preserves managed empty zero',()=>{
 const {itemQuantity}=require('../components/orders/order-expanded-tabs.tsx');
 const managed={compositionManaged:true,items:[]};
 assert.equal(itemQuantity(managed),0);
 assert.equal(itemQuantity({...managed,items:[{quantity:7,archivedAt:'2026-10-15'}]}),0);
 assert.equal(itemQuantity({...managed,items:[{quantity:7,archivedAt:'2026-10-15'},{quantity:2},{quantity:3}]}),5);
 assert.equal(itemQuantity({compositionManaged:false,items:[]}),1);
});
