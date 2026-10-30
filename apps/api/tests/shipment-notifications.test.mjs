import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const filename = new URL('../src/shipping/tracking-link.ts', import.meta.url);
const code = ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exports = {}; vm.runInNewContext(code,{exports,URL});
const { trackingLink, validTrackingLink } = exports;
test('official parcel-bound tracking links preserve number and reject hostile or mismatched URLs',()=>{
 const n='PC0000020000072054NPG';
 assert.equal(trackingLink({carrier:'NOVA_GLOBAL',trackingNumber:n}),`https://novaposhtaglobal.ua/track/?Tracking_ID=${n}`);
 assert.equal(trackingLink({carrier:'UPS',trackingNumber:'1Z999AA10123456784'}),'https://www.ups.com/track?loc=en_US&tracknum=1Z999AA10123456784');
 for(const url of ['http://novaposhtaglobal.ua/track/?Tracking_ID='+n,'https://novaposhtaglobal.ua.evil.test/track/?Tracking_ID='+n,'https://novaposhtaglobal.ua@evil.test/'+n,'https://novaposhtaglobal.ua/track/?Tracking_ID=wrong','https://novaposhtaglobal.ua/track/?Tracking_ID='+n+'&redirect=https://evil.test']) assert.equal(validTrackingLink('NOVA_GLOBAL',n,url),false,url);
 assert.equal(trackingLink({carrier:'NOVA_GLOBAL',trackingNumber:n,trackingUrl:'https://evil.test/'+n}),undefined,'invalid saved URL cannot silently fall back');
});
test('unsupported or multi-number formats never produce speculative links',()=>{
 for(const trackingNumber of ['', 'a b', '123\n456', 'a?x=1', '123/456']) assert.equal(trackingLink({carrier:'NOVA_GLOBAL',trackingNumber}),undefined);
 assert.equal(trackingLink({carrier:'NOVA_POSHTA',trackingNumber:'02000000000001'}),'https://tracking.novaposhta.ua/#/uk/02000000000001');
 assert.equal(trackingLink({carrier:'UKRPOSHTA',trackingNumber:'RR123456789UA'}),'https://track.ukrposhta.ua/?barcode=RR123456789UA');
 assert.equal(trackingLink({carrier:'DHL',trackingNumber:'1234567890'}),'https://www.dhl.com/us-en/home/tracking.html?submit=1&tracking-id=1234567890');
});

test('official Nova Global alias binds the complete NPG parcel even under a legacy Nova Poshta carrier',()=>{
 const n='PC0000020000000001NPG',url=`https://nova.global/track/?Tracking_ID=${n}`;
 assert.equal(validTrackingLink('NOVA_GLOBAL',n,url),true);
 assert.equal(validTrackingLink('NOVA_POSHTA',n,url),true);
 assert.equal(trackingLink({carrier:'NOVA_POSHTA',trackingNumber:n,trackingUrl:url}),url);
 assert.equal(validTrackingLink('NOVA_POSHTA',n,`https://novaposhtaglobal.ua/track/?Tracking_ID=${n}`),true);
 for(const carrier of ['UPS','DHL','UKRPOSHTA','UNKNOWN'])assert.equal(validTrackingLink(carrier,n,url),false,carrier);
 for(const bad of [url.replace(n,n.slice(0,-3)),url.replace('nova.global','nova.global.evil.test'),url.replace('https:','http:'),url+'&redirect=https://evil.test',url+'&Tracking_ID='+n,url+'#other'])assert.equal(validTrackingLink('NOVA_POSHTA',n,bad),false,bad);
 assert.equal(validTrackingLink('NOVA_POSHTA','02000000000001','https://nova.global/track/?Tracking_ID=02000000000001'),false);
 assert.equal(trackingLink({carrier:'NOVA_POSHTA',trackingNumber:n}),`https://nova.global/ua-ua/track/?Tracking_ID=${n}`,'the saved international Nova number supplies its verified route without re-pasting');
});

test('language routes keep complete number and reject unsupported locales',()=>{
 const n='PC0000020000000001NPG';
 for(const language of ['ua-ua','en-ua'])assert.equal(validTrackingLink('NOVA_GLOBAL',n,`https://nova.global/${language}/track/?Tracking_ID=${n}`),true);
 for(const language of ['ru-ua','en-us','../evil'])assert.equal(validTrackingLink('NOVA_GLOBAL',n,`https://nova.global/${language}/track/?Tracking_ID=${n}`),false);
});
