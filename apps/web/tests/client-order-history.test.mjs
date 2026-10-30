import test from 'node:test';
import assert from 'node:assert/strict';
import {ClientOrderHistoryCache, ClientOrderHistoryStaleError, ClientOrderHistoryValidationError} from '../lib/client-order-history.ts';
const row=(clientId='client-a',id='order-z',createdAt='2026-10-29T10:00:00.000Z')=>({id,clientId,number:'YO-123',createdAt,priceMinor:12500,currency:'EUR',salesStatus:'NEW_LEAD'});
const response=(clientId='client-a',page=1)=>({client:{id:clientId,displayName:'Юнікод client',country:null,source:'INSTAGRAM'},summary:{total:1,completed:0,inProgress:1,cancelled:0},items:page===1?[row(clientId)]:[],page,pageSize:20,total:1});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
test('duplicate client rows share one load and expose the complete typed response',async()=>{
 const held=deferred(),calls=[];const cache=new ClientOrderHistoryCache((id,page)=>{calls.push([id,page]);return held.promise;});
 const first=cache.get('client-a'),second=cache.get('client-a');await Promise.resolve();assert.deepEqual(calls,[['client-a',1]]);held.resolve(response());
 assert.deepEqual(await first,response());assert.strictEqual(await first,await second);assert.deepEqual(await cache.get('client-a'),response());assert.equal(calls.length,1);
});

test('shrinking history accepts the exact server clamp and exposes the actual page',async()=>{
 const cache=new ClientOrderHistoryCache(async()=>response());const result=await cache.get('client-a',99);assert.equal(result.page,1);assert.equal(result.total,1);assert.equal(result.items[0].id,'order-z');
});

const batch=(clientId,page,total=37)=>{
 const actual=Math.min(page,Math.max(1,Math.ceil(total/20))),start=(actual-1)*20;
 return{client:{id:clientId,displayName:'Synthetic client',source:'WEBSITE'},summary:{total,completed:0,inProgress:total,cancelled:0},items:Array.from({length:Math.min(20,Math.max(0,total-start))},(_,n)=>row(clientId,'order-'+(start+n),new Date(Date.UTC(2026,9,29)-1000*(start+n)).toISOString())),page:actual,pageSize:20,total};
};
test('TTL is exactly 30 seconds from successful completion, not request start',async()=>{
 let time=0,calls=0;const held=deferred(),cache=new ClientOrderHistoryCache(()=>{calls++;return calls===1?held.promise:Promise.resolve(response());},()=>time);
 const first=cache.get('client-a');await Promise.resolve();time=40_000;held.resolve(response());await first;time=69_999;await cache.get('client-a');assert.equal(calls,1);time=70_000;await cache.get('client-a');assert.equal(calls,2);
});
test('network and synchronous loader failures evict for retry and preserve the error',async()=>{
 const failure=Object.assign(Error('synthetic'),{status:503});let calls=0;const cache=new ClientOrderHistoryCache(()=>{calls++;if(calls===1)throw failure;if(calls===2)return Promise.reject(failure);return Promise.resolve(response());});
 await assert.rejects(cache.get('client-a'),e=>e===failure);await assert.rejects(cache.get('client-a'),e=>e===failure);assert.deepEqual(await cache.get('client-a'),response());assert.equal(calls,3);
});
test('client invalidation prevents an old completion from replacing a newer cached result',async()=>{
 const a=deferred(),b=deferred();let calls=0;const cache=new ClientOrderHistoryCache(()=>++calls===1?a.promise:b.promise);
 const old=cache.get('client-a');const stale=assert.rejects(old,ClientOrderHistoryStaleError);await Promise.resolve();cache.invalidate('client-a');const current=cache.get('client-a');await Promise.resolve();const fresh=response();fresh.client.displayName='Fresh';b.resolve(fresh);assert.equal((await current).client.displayName,'Fresh');a.resolve(response());await stale;assert.equal((await cache.get('client-a')).client.displayName,'Fresh');assert.equal(calls,2);
});
test('an invalidated rejection cannot evict a newer request or leak its obsolete error',async()=>{
 const held=deferred();let calls=0;const cache=new ClientOrderHistoryCache(()=>++calls===1?held.promise:Promise.resolve(response()));const old=cache.get('client-a');const stale=assert.rejects(old,ClientOrderHistoryStaleError);await Promise.resolve();cache.invalidate('client-a');await cache.get('client-a');held.reject(Error('obsolete'));await stale;await cache.get('client-a');assert.equal(calls,2);
});
test('invalidate all rejects pending clients, while targeted invalidation keeps another client cached',async()=>{
 const pending=new Map([['client-a',deferred()],['client-b',deferred()]]),calls=[];let hold=true;const cache=new ClientOrderHistoryCache((id,page)=>{calls.push([id,page]);return hold?pending.get(id).promise:Promise.resolve(response(id));});
 const a=cache.get('client-a'),b=cache.get('client-b');const old=[assert.rejects(a,ClientOrderHistoryStaleError),assert.rejects(b,ClientOrderHistoryStaleError)];await Promise.resolve();cache.invalidate();hold=false;await cache.get('client-a');await cache.get('client-b');pending.get('client-a').resolve(response('client-a'));pending.get('client-b').resolve(response('client-b'));await Promise.all(old);
 cache.invalidate('client-a');await cache.get('client-b');assert.equal(calls.length,4);await cache.get('client-a');assert.equal(calls.length,5);
});
test('client and page keys cannot cross-contaminate, including concurrent responses',async()=>{
 const a=deferred(),b=deferred();const cache=new ClientOrderHistoryCache(id=>id==='client-a'?a.promise:b.promise);const first=cache.get('client-a'),second=cache.get('client-b');b.resolve(response('client-b'));a.resolve(response());assert.equal((await second).client.id,'client-b');assert.equal((await first).items[0].clientId,'client-a');
 const pages=new ClientOrderHistoryCache(async(id,page)=>batch(id,page));assert.equal((await pages.get('client-a',2)).items.length,17);assert.equal((await pages.get('client-a',99)).page,2);assert.equal((await pages.get('client-a',1)).items.length,20);
});
test('empty history is complete and honest, including clamp to page one',async()=>{
 const value=await new ClientOrderHistoryCache(async(id,page)=>batch(id,page,0)).get('client-a',8);assert.deepEqual(value.summary,{total:0,completed:0,inProgress:0,cancelled:0});assert.deepEqual(value.items,[]);assert.equal(value.page,1);
});
test('cache retains at most fifty recently used clients',async()=>{
 const calls=new Map();const cache=new ClientOrderHistoryCache(async id=>{calls.set(id,(calls.get(id)||0)+1);return response(id);});for(let n=0;n<50;n++)await cache.get('client-'+n);await cache.get('client-0');await cache.get('client-50');await cache.get('client-0');assert.equal(calls.get('client-0'),1);await cache.get('client-1');assert.equal(calls.get('client-1'),2);
});
test('cache bounds page keys at one hundred without evicting a recently used page',async()=>{
 const calls=new Map();const cache=new ClientOrderHistoryCache(async(id,page)=>{calls.set(page,(calls.get(page)||0)+1);return batch(id,page,3000);});for(let n=1;n<=100;n++)await cache.get('client-a',n);await cache.get('client-a',1);await cache.get('client-a',101);await cache.get('client-a',1);assert.equal(calls.get(1),1);await cache.get('client-a',2);assert.equal(calls.get(2),2);
});
test('pending page keys are bounded and an evicted completion cannot repopulate',async()=>{
 const first=deferred();let calls=0;const cache=new ClientOrderHistoryCache(async(id,page)=>{if(page===1&&++calls===1)return first.promise;return batch(id,page,3000);});const old=cache.get('client-a',1),stale=assert.rejects(old,ClientOrderHistoryStaleError);await Promise.resolve();for(let n=2;n<=101;n++)await cache.get('client-a',n);first.resolve(batch('client-a',1,3000));await stale;await cache.get('client-a',1);assert.equal(calls,2);
});
test('returned pages are defensive immutable projections, not mutable transport objects',async()=>{
 const raw=response();raw.extra='not-public';raw.items[0].notes='not-public';const cache=new ClientOrderHistoryCache(async()=>raw);const saved=await cache.get('client-a');raw.client.id='other';raw.items[0].clientId='other';raw.summary.total=999;
 assert.equal((await cache.get('client-a')).client.id,'client-a');assert.equal(saved.items[0].clientId,'client-a');assert.equal(saved.summary.total,1);assert.equal('extra'in saved,false);assert.equal('notes'in saved.items[0],false);assert.throws(()=>saved.items.push(row()),TypeError);assert.throws(()=>{saved.client.id='changed';},TypeError);
});
test('invalid request keys never issue a loader call',async()=>{
 let calls=0;const cache=new ClientOrderHistoryCache(async()=>{calls++;return response();});for(const [id,page]of [['',1],['   ',1],[null,1],['x'.repeat(201),1],['client-a',0],['client-a',-1],['client-a',1.5],['client-a',Number.MAX_SAFE_INTEGER]])await assert.rejects(cache.get(id,page),ClientOrderHistoryValidationError);assert.equal(calls,0);
});
test('same-millisecond order ties preserve descending IDs, and mixed currencies remain individual',async()=>{
 const raw=response();raw.total=2;raw.summary={total:2,completed:1,inProgress:0,cancelled:1};raw.items=[row('client-a','z'),{...row('client-a','a'),priceMinor:0,currency:'USD',salesStatus:'CANCELLED'}];const result=await new ClientOrderHistoryCache(async()=>raw).get('client-a');assert.deepEqual(result.items.map(x=>x.id),['z','a']);assert.deepEqual(result.items.map(x=>x.currency),['EUR','USD']);assert.equal(result.summary.completed,1);
});
const malformed=[
 ['missing summary',r=>{delete r.summary;}],['unknown total',r=>{delete r.total;}],['foreign returned client',r=>{r.client.id='client-b';}],['foreign order owner',r=>{r.items[0].clientId='client-b';}],
 ['missing country is allowed but wrong country type is not',r=>{r.client.country=1;}],['empty display name',r=>{r.client.displayName=' ';}],['missing source',r=>{delete r.client.source;}],
 ['disjoint summary mismatch',r=>{r.summary.completed=1;}],['negative summary',r=>{r.summary.cancelled=-1;}],['fractional count',r=>{r.summary.inProgress=0.5;}],['unsafe total',r=>{r.total=r.summary.total=Number.MAX_SAFE_INTEGER+1;}],['top total mismatch',r=>{r.total=2;}],
 ['wrong page',r=>{r.page=2;}],['wrong page size',r=>{r.pageSize=10;}],['missing page item',r=>{r.items=[];}],['not an array',r=>{r.items={};}],['duplicate order IDs',r=>{r.total=r.summary.total=r.summary.inProgress=2;r.items.push({...r.items[0]});}],
 ['negative money',r=>{r.items[0].priceMinor=-1;}],['fractional money',r=>{r.items[0].priceMinor=0.5;}],['unsafe money',r=>{r.items[0].priceMinor=Number.MAX_SAFE_INTEGER+1;}],['non ISO currency',r=>{r.items[0].currency='eur';}],['invalid timestamp',r=>{r.items[0].createdAt='yesterday';}],['impossible calendar date',r=>{r.items[0].createdAt='2026-02-30T10:00:00Z';}],['empty order ID',r=>{r.items[0].id='';}],['missing order number',r=>{delete r.items[0].number;}],['missing status',r=>{delete r.items[0].salesStatus;}],
 ['ascending date order',r=>{r.total=r.summary.total=r.summary.inProgress=2;r.items=[row('client-a','a','2026-10-28T10:00:00Z'),row('client-a','z')];}],
];
for(const [name,mutate]of malformed)test('malformed '+name+' rejects without fallback and retries cleanly',async()=>{
 const bad=response();mutate(bad);let calls=0;const cache=new ClientOrderHistoryCache(async()=>++calls===1?bad:response());await assert.rejects(cache.get('client-a'),ClientOrderHistoryValidationError);assert.deepEqual(await cache.get('client-a'),response());assert.equal(calls,2);
});
test('primitive and partial payloads never become fabricated empty history',async()=>{
 for(const value of [null,[],{},'unknown',{client:{id:'client-a'},summary:{total:0}}])await assert.rejects(new ClientOrderHistoryCache(async()=>value).get('client-a'),ClientOrderHistoryValidationError);
});

test('bounded opaque client IDs allow legacy punctuation and Unicode without CUID assumptions',async()=>{
 const id='legacy.client/id:α_42',calls=[];const cache=new ClientOrderHistoryCache(async(value,page)=>{calls.push([value,page]);return response(value);});assert.equal((await cache.get(id)).client.id,id);assert.deepEqual(calls,[[id,1]]);
});
test('client IDs containing whitespace or controls reject before transport',async()=>{
 let calls=0;const cache=new ClientOrderHistoryCache(async id=>{calls++;return response(id);});for(const id of ['client a',' client','client\n','client\t','client\0','client\x7f','client\u0085','client\u00a0'])await assert.rejects(cache.get(id),ClientOrderHistoryValidationError);assert.equal(calls,0);
});
test('separate dashboard cache instances never share responses or invalidation',async()=>{
 let firstCalls=0,secondCalls=0;const first=new ClientOrderHistoryCache(async()=>{firstCalls++;return response();});const second=new ClientOrderHistoryCache(async()=>{secondCalls++;const r=response();r.client.displayName='Other role';return r;});await first.get('client-a');assert.equal((await second.get('client-a')).client.displayName,'Other role');first.invalidate();await second.get('client-a');assert.equal(secondCalls,1);await first.get('client-a');assert.equal(firstCalls,2);
});

test('equal timestamps preserve opaque backend tie order without JavaScript collation assumptions',async()=>{
 for(const ids of [['z','ä'],['a','z'],['ä','Z'],['legacy:α','legacy:z']]){
  const raw=response();raw.total=raw.summary.total=raw.summary.inProgress=2;raw.items=ids.map(id=>row('client-a',id));
  const result=await new ClientOrderHistoryCache(async()=>raw).get('client-a');assert.deepEqual(result.items.map(item=>item.id),ids);
 }
});

const extended=()=>{
 const r=response();r.total=r.summary.total=r.summary.inProgress=2;
 r.items=[{...row(),country:'UA',designCount:3,quantity:7,designs:[{id:'item-z',name:'Gold design',imageUrl:'/api/orders/images/keycrm-'+ 'a'.repeat(32)+'.jpg'},{id:'legacy:item/α',name:'Blue design',imageUrl:'https://cdn.example.com/blue.webp?width=120'}]}, {...row('client-a','order-a','2026-10-28T10:00:00.000Z'),currency:'USD',priceMinor:4500,country:null,designCount:0,quantity:0,designs:[]}];
 r.totalsByCurrency=[{currency:'EUR',totalMinor:12500},{currency:'USD',totalMinor:4500}];return r;
};
test('extended history keeps native-currency totals and two active design previews without changing quantity',async()=>{
 const raw=extended(),result=await new ClientOrderHistoryCache(async()=>raw).get('client-a');assert.deepEqual(result,raw);assert.equal(result.items[0].designCount,3);assert.equal(result.items[0].quantity,7);assert.equal(result.items[0].designs.length,2);
});

test('optional extension fields can be absent independently without invented defaults',async()=>{
 const raw=response();raw.items[0].country='Deutschland';const r=await new ClientOrderHistoryCache(async()=>raw).get('client-a');assert.equal(r.items[0].country,'Deutschland');assert.equal('quantity'in r.items[0],false);assert.equal('designCount'in r.items[0],false);assert.equal('designs'in r.items[0],false);assert.equal('totalsByCurrency'in r,false);
});
test('empty native totals are valid only for honestly empty history and zero money stays zero',async()=>{
 const empty=batch('client-a',1,0);empty.totalsByCurrency=[];assert.deepEqual((await new ClientOrderHistoryCache(async()=>empty).get('client-a')).totalsByCurrency,[]);
 const raw=extended();raw.items[0].priceMinor=0;raw.totalsByCurrency[0].totalMinor=0;assert.equal((await new ClientOrderHistoryCache(async()=>raw).get('client-a')).totalsByCurrency[0].totalMinor,0);
});
test('all existing managed image names and public HTTPS forms are retained safely',async()=>{
 for(const image of ['/api/orders/images/abcdef-123.jpg','/api/orders/images/a.png','/api/orders/images/a.webp','/api/orders/images/keycrm-'+ 'b'.repeat(32)+'.jpg','https://cdn.example.com/a.jpg?v=2&width=100','https://8.8.8.8/a.jpg','https://[2606:4700:4700::1111]/a.jpg']){
  const raw=extended();raw.items[0].designs[0].imageUrl=image;const result=await new ClientOrderHistoryCache(async()=>raw).get('client-a');assert.equal(result.items[0].designs[0].imageUrl,image);
 }
});
test('extended snapshots deeply freeze designs/totals and discard noncontract private fields',async()=>{
 const raw=extended();raw.items[0].designs[0].privateSource='secret';raw.totalsByCurrency[0].rate='invented';const cache=new ClientOrderHistoryCache(async()=>raw),saved=await cache.get('client-a');raw.items[0].designs[0].name='changed';raw.totalsByCurrency[0].totalMinor=1;
 assert.equal(saved.items[0].designs[0].name,'Gold design');assert.equal(saved.totalsByCurrency[0].totalMinor,12500);assert.equal('privateSource'in saved.items[0].designs[0],false);assert.equal('rate'in saved.totalsByCurrency[0],false);
 assert.throws(()=>{saved.items[0].designs[0].imageUrl='javascript:bad';},TypeError);assert.throws(()=>saved.totalsByCurrency.push({currency:'UAH',totalMinor:3}),TypeError);
});
test('invalidated extended responses cannot repopulate or replace fresh design/currency evidence',async()=>{
 const held=deferred();let calls=0;const cache=new ClientOrderHistoryCache(async()=>++calls===1?held.promise:extended());const pending=cache.get('client-a'),stale=assert.rejects(pending,ClientOrderHistoryStaleError);await Promise.resolve();cache.invalidate('client-a');const fresh=await cache.get('client-a');const old=extended();old.items[0].designs[0].imageUrl='javascript:obsolete';held.resolve(old);await stale;assert.strictEqual(await cache.get('client-a'),fresh);assert.equal(calls,2);
});
const invalidExtended=[
 ['country type',r=>{r.items[0].country=3;}],['country bound',r=>{r.items[0].country='x'.repeat(101);} ],['country controls',r=>{r.items[0].country='UA\0';}],
 ['fractional design count',r=>{r.items[0].designCount=2.5;}],['unsafe design count',r=>{r.items[0].designCount=Number.MAX_SAFE_INTEGER+1;}],['negative quantity',r=>{r.items[0].quantity=-1;}],['fractional quantity',r=>{r.items[0].quantity=0.5;}],['unsafe quantity',r=>{r.items[0].quantity=Infinity;}],
 ['too many previews',r=>{r.items[0].designs.push({id:'third',name:'third',imageUrl:null});}],['preview count exceeds designs',r=>{r.items[0].designCount=1;}],['null designs',r=>{r.items[0].designs=null;}],['duplicate preview IDs',r=>{r.items[0].designs[1].id=r.items[0].designs[0].id;}],['invalid preview ID',r=>{r.items[0].designs[0].id='item x';}],['empty preview name',r=>{r.items[0].designs[0].name=' ';}],['oversized preview name',r=>{r.items[0].designs[0].name='x'.repeat(501);} ],['missing image value',r=>{delete r.items[0].designs[0].imageUrl;}],
 ['foreign client',r=>{r.client.id='client-b';}],['foreign order owner',r=>{r.items[0].clientId='client-b';}],['null totals',r=>{r.totalsByCurrency=null;}],['missing currency group',r=>{r.totalsByCurrency.pop();}],['duplicate currencies',r=>{r.totalsByCurrency[1].currency='EUR';}],['non ISO currency',r=>{r.totalsByCurrency[0].currency='eur';}],['float total',r=>{r.totalsByCurrency[0].totalMinor=12500.1;}],['unsafe total',r=>{r.totalsByCurrency[0].totalMinor=Number.MAX_SAFE_INTEGER+1;}],['negative total',r=>{r.totalsByCurrency[0].totalMinor=-1;}],['missing total',r=>{delete r.totalsByCurrency[0].totalMinor;}],['undersized native subtotal',r=>{r.items[1].currency='EUR';r.totalsByCurrency=[{currency:'EUR',totalMinor:16000}];}],['unbounded currency groups',r=>{r.totalsByCurrency=Array(257).fill({currency:'EUR',totalMinor:1});}],
];
for(const [name,mutate]of invalidExtended)test('extended malformed '+name+' rejects and permits clean retry',async()=>{
 const raw=extended();mutate(raw);let calls=0;const cache=new ClientOrderHistoryCache(async()=>++calls===1?raw:extended());await assert.rejects(cache.get('client-a'),ClientOrderHistoryValidationError);assert.deepEqual(await cache.get('client-a'),extended());
});
const unsafeAssets=['javascript:alert(1)','data:image/png;base64,AA==','blob:https://cdn.example.com/a','http://cdn.example.com/a.jpg','//cdn.example.com/a.jpg','/api/admin/backups/private','/api/orders/images/../secret.jpg','/api/orders/images/%2e%2e%2fsecret.jpg','/api/orders/images/ABC.jpg','/api/orders/images/keycrm-bad.jpg','/api/orders/images/a.svg','/api/orders/images/a.jpg?token=private','https://user:password@cdn.example.com/a.jpg','https://cdn.example.com:8443/a.jpg','https://cdn.example.com/a.jpg#token','https://localhost/a.jpg','https://media.localhost/a.jpg','https://host.internal/a.jpg','https://127.0.0.1/a.jpg','https://2130706433/a.jpg','https://0x7f000001/a.jpg','https://10.1.2.3/a.jpg','https://100.64.0.1/a.jpg','https://169.254.169.254/a.jpg','https://172.16.0.1/a.jpg','https://192.168.1.1/a.jpg','https://192.0.2.1/a.jpg','https://198.51.100.1/a.jpg','https://203.0.113.1/a.jpg','https://224.0.0.1/a.jpg','https://[::1]/a.jpg','https://[::ffff:127.0.0.1]/a.jpg','https://[fc00::1]/a.jpg','https://[fe80::1]/a.jpg','https://[2001:db8::1]/a.jpg','https://cdn.example.com/a.jpg?access_token=secret','https://cdn.example.com/a.jpg?X-Amz-Signature=secret','https://cdn.example.com/a.jpg?authorization=Bearer%20secret','https://cdn.example.com/a.jpg?x=Bearer%20secret'];
for(const image of unsafeAssets)test('unsafe asset is never exposed: '+image.replace(/\?.*/,''),async()=>{
 const raw=extended();raw.items[0].designs[0].imageUrl=image;await assert.rejects(new ClientOrderHistoryCache(async()=>raw).get('client-a'),ClientOrderHistoryValidationError);
});
