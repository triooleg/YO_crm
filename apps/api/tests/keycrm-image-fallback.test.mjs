import assert from 'node:assert/strict';
import test from 'node:test';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

// Pure operational policy only. No provider calls, DB, importer changes or file
// materialization. Runtime downloader SSRF/MIME/size coverage remains separate.
const root=resolve(process.env.YO_CRM_SOURCE_ROOT??resolve(dirname(fileURLToPath(import.meta.url)),'../../..'));
const require=createRequire(import.meta.url);
const load=()=>require(resolve(root,'scripts/keycrm-image-repair-policy.cjs'));
const full='https://cdn.example.test/product-701-original.jpg';
const original='https://cdn.example.test/product-701-alternate.jpg';
const thumbnail='https://thumbnail.example.test/product-701.jpg';
const unrelated='https://files.example.test/product-702.jpg';
const product=()=>({id:701,name:'Same design name',picture:{url:full,thumbnail}});
const rawOrder=()=>({id:53,products:[product(),{id:702,name:'Same design name',picture:{url:unrelated}}],files:[{id:701,name:'Same design name',url:unrelated}]});

// Agreed API: imageCandidates(picture), findImageProduct(rawOrder,externalItemId).
// A 403 primary can be followed by this SAME product's thumbnail by the parent
// executor. The policy never makes that HTTP request or reorders a working full URL.
test('operational image policy exposes only the agreed callable seams',()=>{
 const policy=load();assert.equal(typeof policy.imageCandidates,'function');assert.equal(typeof policy.findImageProduct,'function');
});

test('candidate preference is primary, original_file_url, thumbnail; full image remains first',()=>{
 assert.deepEqual(load().imageCandidates({url:full,original_file_url:original,thumbnail}),[full,original,thumbnail]);
});

test('sample 53 exact product retains distinct thumbnail after its forbidden primary URL',()=>{
 const raw=rawOrder(),policy=load(),selected=policy.findImageProduct(raw,'53:701');assert.deepEqual(selected,raw.products[0]);assert.deepEqual(policy.imageCandidates(selected.picture),[full,thumbnail]);assert.notEqual(full,thumbnail);assert.ok(!policy.imageCandidates(selected.picture).includes(unrelated));
});

test('candidate collection deduplicates without promoting thumbnail over full rendition',()=>{
 assert.deepEqual(load().imageCandidates({url:full,original_file_url:full,thumbnail:full}),[full]);assert.deepEqual(load().imageCandidates({url:full,original_file_url:original,thumbnail:full}),[full,original]);
});

test('legacy string picture is one HTTPS candidate and whitespace is trimmed',()=>{
 assert.deepEqual(load().imageCandidates(full),[full]);assert.deepEqual(load().imageCandidates('  '+full+'  '),[full]);
});

test('HTTP, relative, data/javascript, credential-bearing and custom-port URLs are excluded',()=>{
 const {imageCandidates}=load();for(const value of ['http://cdn.example.test/a.jpg','//cdn.example.test/a.jpg','/api/private/photo.jpg','data:image/jpeg;base64,AA==','javascript:alert(1)','https://user:password@cdn.example.test/a.jpg','https://cdn.example.test:8443/a.jpg','not a URL']){assert.deepEqual(imageCandidates(value),[]);assert.deepEqual(imageCandidates({url:value,thumbnail}),[thumbnail]);}
});

test('nulls, empty arrays and unsupported fields never become arbitrary candidates',()=>{
 const {imageCandidates}=load();for(const value of [undefined,null,0,17,true,[],{}])assert.deepEqual(imageCandidates(value),[]);assert.deepEqual(imageCandidates({url:17,original_file_url:{unexpected:original},thumbnail}),[thumbnail]);
});

test('picture arrays flatten in source order, deduplicate and stop at three candidates',()=>{
 const {imageCandidates}=load();assert.deepEqual(imageCandidates([full]),[full]);assert.deepEqual(imageCandidates([{url:full},full,{url:original,thumbnail},unrelated]),[full,original,thumbnail]);assert.deepEqual(imageCandidates([null,'http://private.example.test/a.jpg',{thumbnail},full,thumbnail,original,unrelated]),[thumbnail,full,original]);
});

test('at most three explicitly named candidates; extra images/files/name fields are ignored',()=>{
 const {imageCandidates}=load();assert.deepEqual(imageCandidates({url:full,original_file_url:original,thumbnail,files:[{url:unrelated}],images:[unrelated],name:unrelated,extra:unrelated}),[full,original,thumbnail]);
});

test('product lookup uses exact order/product external identity independent of names or order',()=>{
 const {findImageProduct}=load(),raw=rawOrder();assert.deepEqual(findImageProduct(raw,'53:701'),raw.products[0]);raw.products.reverse();assert.equal(findImageProduct(raw,'53:701')?.id,701);assert.equal(findImageProduct(raw,'53:702')?.picture.url,unrelated);
});

test('wrong order, partial/padded identity and same product name cannot match',()=>{
 const {findImageProduct}=load(),raw=rawOrder();for(const id of ['54:701','053:701','53:0701','53:70','53:7010','53:701:extra','701','Same design name',' 53:701','53:701 ',undefined,null,701])assert.equal(findImageProduct(raw,id),undefined);
});

test('duplicate matching product IDs are ambiguous even when pictures match',()=>{
 const {findImageProduct}=load(),raw=rawOrder();raw.products.push(structuredClone(raw.products[0]));assert.equal(findImageProduct(raw,'53:701'),undefined);raw.products[2].picture={url:unrelated};assert.equal(findImageProduct(raw,'53:701'),undefined);
});

test('missing product cannot be recovered from arbitrary files or a related product',()=>{
 const {findImageProduct}=load(),raw=rawOrder();raw.products=raw.products.filter(p=>p.id!==701);assert.equal(findImageProduct(raw,'53:701'),undefined);assert.equal(findImageProduct({...raw,products:[]},'53:701'),undefined);
});

test('invalid raw order/product containers and absent IDs fail closed without matching',()=>{
 const {findImageProduct}=load();for(const raw of [null,undefined,[],{}, {id:53,products:null},{id:53,products:{}},{id:53,products:[null,{},[]]},{products:[product()]}])assert.equal(findImageProduct(raw,'53:701'),undefined);
});

test('zero, negative, fractional and missing order/product IDs cannot match a templated identity',()=>{
 const {findImageProduct}=load();for(const id of [0,-1,1.5,NaN,Infinity,null,undefined,'',false]){const order=rawOrder();order.id=id;assert.equal(findImageProduct(order,String(id)+':701'),undefined);const withBadProduct=rawOrder();withBadProduct.products=[{...product(),id}];assert.equal(findImageProduct(withBadProduct,'53:'+String(id)),undefined);}
});

test('policy is read-only and preserves valid local/manual image and provider metadata',()=>{
 const policy=load(),raw=rawOrder();raw.products[0].modelImagePath='manual-existing-photo.jpg';raw.products[0].picture.original_file_url=original;raw.products[0].metadata={providerId:'fixture-only',notes:'unchanged'};const before=structuredClone(raw);const selected=policy.findImageProduct(raw,'53:701');policy.imageCandidates(selected.picture);assert.deepEqual(raw,before);assert.equal(selected.modelImagePath,'manual-existing-photo.jpg');
});
