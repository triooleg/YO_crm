import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';
import { generateKeyPairSync } from 'node:crypto';
const require = createRequire(import.meta.url);
function load(name, overrides = {}) {
  const file = name instanceof URL ? name : new URL('../src/web-push/' + name + '.ts', import.meta.url);
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, experimentalDecorators: true, emitDecoratorMetadata: true } }).outputText;
  vm.runInNewContext(code, { module, exports: module.exports, require: name => name in overrides ? overrides[name] : name.startsWith('.') ? load(new URL(name + '.ts', file)) : require(name), URL, Buffer, process, Reflect });
  return module.exports;
}
const policy = load('web-push-policy');
const publicKey = generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
const p256dh = Buffer.concat([Buffer.from([4]), Buffer.from(publicKey.x, 'base64url'), Buffer.from(publicKey.y, 'base64url')]).toString('base64url');
const valid = { endpoint: 'https://fcm.googleapis.com/fcm/send/test-token', keys: { p256dh, auth: Buffer.alloc(16, 7).toString('base64url') }, topics: { messages: true, websiteOrders: false } };
test('push subscriptions allow official HTTPS providers and reject SSRF and malformed keys', () => {
  assert.equal(policy.validateSubscription(valid).endpoint, valid.endpoint);
  for (const endpoint of ['http://fcm.googleapis.com/fcm/send/test', 'https://127.0.0.1/a', 'https://localhost/a', 'https://fcm.googleapis.com.evil.test/fcm/send/a', 'https://fcm.googleapis.com@evil.test/a', 'https://fcm.googleapis.com:444/fcm/send/a', 'https://example.com/a', 'https://fcm.googleapis.com/fcm/send/a#x']) assert.throws(() => policy.validateSubscription({ ...valid, endpoint }), endpoint);
  for (const keys of [{ p256dh: 'bad', auth: valid.keys.auth }, { p256dh, auth: 'bad' }, { p256dh: Buffer.alloc(65).toString('base64url'), auth: valid.keys.auth }]) assert.throws(() => policy.validateSubscription({ ...valid, keys }));
  assert.throws(() => policy.validateSubscription({ ...valid, topics: { messages: 'yes', websiteOrders: false } }));
  for (const endpoint of ['https://updates.push.services.mozilla.com/wpush/v2/token', 'https://web.push.apple.com/token', 'https://wns2-par02p.notify.windows.com/w/?token=a']) assert.equal(policy.validateEndpoint(endpoint), endpoint);
});
test('payload has generic copy, stable dedupe tag and fixed relative routes', () => {
  for (const [topic, url] of [['messages', '/?section=inbox'], ['websiteOrders', '/?section=orders']]) {
    const value = policy.notificationPayload(topic, 'fixed-delivery');
    assert.equal(value.url, url);
    assert.equal(value.tag, 'crm-push-fixed-delivery');
    assert.equal(value.body.includes('customer'), false);
    assert.equal(value.topic, topic);
  }
  assert.throws(() => policy.notificationPayload('external', 'id'));
});
test('VAPID is disabled without explicit configuration and valid keys', () => {
  assert.equal(policy.webPushConfiguration({}), null);
  assert.equal(policy.webPushConfiguration({ WEB_PUSH_ENABLED: 'true' }), null);
  assert.equal(policy.webPushConfiguration({ WEB_PUSH_ENABLED: 'false', WEB_PUSH_VAPID_PUBLIC_KEY: p256dh }), null);
});

const { createHash } = await import('node:crypto');
const tokenHash = createHash('sha256').update('session-token').digest('hex');
const user = { id: 'owner', role: 'OWNER', active: true, archivedAt: null };
const liveSession = { tokenHash, userId: user.id, user, expiresAt: new Date(Date.now()+86400000) };
const configuredPolicy = { ...policy, webPushConfiguration: () => ({ subject: 'https://crm.yoleotard.com/', publicKey: 'public', privateKey: 'private' }) };

test('real outbox SQL enforces watermark, per-device consent time, roles, sessions, dedupe and transaction rollback', async t => {
  const { PGlite } = createRequire(new URL('../../../packages/database/package.json', import.meta.url))('@electric-sql/pglite');
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    CREATE TABLE "User" (id TEXT PRIMARY KEY, active BOOLEAN, "archivedAt" TIMESTAMP, role TEXT);
    CREATE TABLE "Session" (id TEXT PRIMARY KEY,"tokenHash" TEXT UNIQUE,"userId" TEXT,"expiresAt" TIMESTAMP);
  `);
  await db.exec(fs.readFileSync(new URL('../../../packages/database/prisma/migrations/20261117170000_web_push/migration.sql',import.meta.url),'utf8'));
  await db.exec(`
    INSERT INTO "User" VALUES ('owner',true,NULL,'OWNER'),('production',true,NULL,'PRODUCTION');
    INSERT INTO "Session" VALUES ('a','live','owner',NOW()+INTERVAL '1 day'),('b','expired','owner',NOW()-INTERVAL '1 day'),('c','prod','production',NOW()+INTERVAL '1 day');
    INSERT INTO "WebPushSubscription" ("id","userId","sessionTokenHash","endpointHash",endpoint,p256dh,auth,messages,"websiteOrders","updatedAt") VALUES
      ('yes','owner','live','yes','x','x','x',true,true,'2026-11-17 10:00:00'),
      ('later','owner','live','later','x','x','x',true,true,'2026-11-17 10:10:00'),
      ('no','owner','live','no','x','x','x',false,false,'2026-11-17 10:00:00'),
      ('old','owner','expired','old','x','x','x',true,true,'2026-11-17 10:00:00'),
      ('prod','production','prod','prod','x','x','x',true,true,'2026-11-17 10:00:00');
  `);
  const capture = load('web-push-capture', { './web-push-policy': configuredPolicy });
  let queries = 0;
  const tx = {
    appSetting: { upsert: async () => ({ value: '2026-11-17T10:00:00.000Z' }) },
    $queryRaw: async (parts,...values) => {
      const query = parts.reduce((text,part,index) => text + (index ? '$'+index : '') + part,'');
      queries++;
      return (await db.query(query,values.map(value=>value instanceof Date ? value.toISOString() : value))).rows;
    },
    $executeRaw: async (parts,...values) => {
      const query = parts.reduce((text,part,index) => text + (index ? '$'+index : '') + part,'');
      queries++;
      return (await db.query(query,values.map(value=>value instanceof Date ? value.toISOString() : value))).affectedRows;
    },
  };
  await capture.captureWebPush(tx,'messages','message:1',new Date('2026-11-17T09:59:00Z'));
  assert.equal(queries,0,'events before global activation are ignored');
  await capture.captureWebPush(tx,'messages','message:1',new Date('2026-11-17T10:05:00Z'));
  await capture.captureWebPush(tx,'messages','message:1',new Date('2026-11-17T10:05:00Z'));
  const rows = (await db.query('SELECT "subscriptionId",topic FROM "WebPushDelivery"')).rows;
  assert.deepEqual(rows,[{subscriptionId:'yes',topic:'messages'}],'new device, opted-out, forbidden role and expired sessions excluded');
  await capture.captureWebPush(tx,'messages','message:1',new Date('2026-11-17T10:20:00Z'));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "WebPushDelivery"')).rows[0].n,1,'event dedupe prevents replay to later subscribers');
  await db.exec('BEGIN');
  await capture.captureWebPush(tx,'websiteOrders','website-order:rollback',new Date('2026-11-17T10:20:00Z'));
  await db.exec('ROLLBACK');
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM "WebPushEvent" WHERE "eventKey"='website-order:rollback'`)).rows[0].n,0);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "WebPushDelivery"')).rows[0].n,1,'business transaction rollback also removes notification');
  await capture.captureWebPush(tx,'websiteOrders','website-order:paid',new Date('2026-11-17T10:20:00Z'));
  assert.equal((await db.query('SELECT count(*)::int AS n FROM "WebPushDelivery"')).rows[0].n,3,'both existing consenting devices receive a later paid purchase');
});

function serviceFixture(options = {}) {
  let previous = options.previous ?? null;
  let writes = 0;
  let audits = 0;
  const locks = [];
  const tx = {
    $executeRaw: async (parts,...values) => { locks.push(values[0]); },
    session: { findFirst: async () => options.ownerSession ?? null, findMany: async () => [{tokenHash}] },
    webPushSubscription: {
      findUnique: async () => previous,
      findFirst: async ({where}) => previous && previous.userId===where.userId && previous.sessionTokenHash===where.sessionTokenHash ? previous : null,
      count: async () => options.count ?? 0,
      upsert: async ({create,update}) => { writes++; previous = {id:'sub',...create,...(previous ? {...update,version:previous.version+1}:{} )}; return previous; },
      updateMany: async ({data}) => { writes++; if(options.conflict) return {count:0}; previous={...previous,...data}; return {count:1}; },
    },
    auditLog: {create:async()=>{audits++;}},
  };
  const prisma = { session: {findUnique:async()=> options.session===undefined ? liveSession : options.session}, webPushSubscription:tx.webPushSubscription, $transaction:async fn=>fn(tx) };
  const {WebPushService} = load('web-push.service', {'../prisma.service':{},'./web-push-policy':configuredPolicy});
  return {service:new WebPushService(prisma), state:()=>({previous,writes,audits,locks})};
}
const existingSubscription = { id:'sub', userId:user.id, sessionTokenHash:tokenHash, endpoint:valid.endpoint, endpointHash:'hash', p256dh, auth:valid.keys.auth, messages:true, websiteOrders:false, revokedAt:null, version:3 };
test('subscription API enforces session, role, per-user cap and idempotent consent',async()=>{
  await assert.rejects(()=>serviceFixture({session:null}).service.subscribe(user,'session-token',valid));
  await assert.rejects(()=>serviceFixture({session:{...liveSession,user:{...user,role:'PRODUCTION'}}}).service.subscribe(user,'session-token',valid));
  await assert.rejects(()=>serviceFixture({count:10}).service.subscribe(user,'session-token',valid));
  await assert.rejects(()=>serviceFixture({previous:{...existingSubscription,userId:'other'},ownerSession:{id:'other-session'}}).service.subscribe(user,'session-token',valid));
  const unchanged=serviceFixture({previous:existingSubscription});
  await unchanged.service.subscribe(user,'session-token',valid);
  assert.equal(unchanged.state().writes,0,'unchanged consent preserves pending deliveries and consent timestamp');
  const fresh=serviceFixture();
  const result=await fresh.service.subscribe(user,'session-token',valid);
  assert.equal(result.ok,true);
  assert.equal(fresh.state().audits,1);
  assert.equal(fresh.state().locks.length,2);
  const disabled=await serviceFixture({session:{...liveSession,user:{...user,role:'PRODUCTION'}}}).service.config(user,'session-token');
  assert.equal(disabled.enabled,false);
});
test('unsubscribe is scoped to user and live session, serializes consent changes, scrubs keys and rejects CAS conflict',async()=>{
  const f=serviceFixture({previous:existingSubscription});
  assert.equal((await f.service.unsubscribe(user,'session-token',{endpoint:valid.endpoint})).ok,true);
  assert.equal(f.state().locks.length,2);
  assert.equal(f.state().previous.auth,'');
  assert.equal(f.state().previous.messages,false);
  assert.equal(f.state().audits,1);
  const other=serviceFixture({previous:{...existingSubscription,userId:'other'}});
  await other.service.unsubscribe(user,'session-token',{endpoint:valid.endpoint});
  assert.equal(other.state().writes,0,'cannot revoke another user device');
  await assert.rejects(()=>serviceFixture({previous:existingSubscription,conflict:true}).service.unsubscribe(user,'session-token',{endpoint:valid.endpoint}));
});

function workerFixture(options={}) {
  let row={id:'delivery',subscriptionId:'sub',topic:'messages',subscriptionVersion:3,status:'PENDING',attempts:0,createdAt:new Date(),...options.delivery};
  let subscription={...existingSubscription,...options.subscription};
  const sends=[];
  const ttls=[];
  const urgencies=[];
  const updates=[];
  const deliveryDelegate={
    findUnique:async()=>row,
    updateMany:async({where,data})=>{
      if(where.status==='PROCESSING' && where.lockedUntil && !(row.status==='PROCESSING' && row.lockedUntil<new Date())) return {count:0};
      row={...row,...data}; updates.push(data);return {count:1};
    },
  };
  const tx={
    $queryRaw:async()=>[],
    webPushDelivery:deliveryDelegate,
    webPushSubscription:{findUnique:async()=>subscription,update:async({data})=>{subscription={...subscription,...data};return subscription;}},
    session:{findUnique:async()=>options.session===undefined ? liveSession : options.session},
  };
  const prisma={
    webPushDelivery:deliveryDelegate,
    $queryRaw:async(parts,...values)=>{
      if(row.status!=='PENDING' || row.availableAt>new Date())return [];
      row={...row,status:'PROCESSING',leaseToken:values[0],attempts:row.attempts+1};
      return [{id:'delivery'}];
    },
    $transaction:async fn=>fn(tx),
  };
  const {WebPushWorker}=load('web-push.worker',{
    '../prisma.service':{},
    './web-push-policy':configuredPolicy,
    './web-push-capture':{ensureWebPushWatermark:async()=>{}},
    '../recovery-safety':{assertExternalSideEffectsAllowed(){}},
    'web-push':{default:{sendNotification:async(_subscription,payload,transportOptions)=>{ttls.push(transportOptions.TTL);urgencies.push(transportOptions.urgency);sends.push(JSON.parse(payload));if(options.error)throw options.error;}}},
  });
  return {worker:new WebPushWorker(prisma),state:()=>({row,subscription,sends,updates,ttls,urgencies})};
}
test('worker sends generic notifications once and cancels stale consent or revoked sessions',async()=>{
  const ok=workerFixture();
  await ok.worker.tick();
  await ok.worker.tick();
  assert.equal(ok.state().sends.length,1);
  assert.ok(ok.state().ttls[0]>86300 && ok.state().ttls[0]<=86400);
  assert.equal(ok.state().row.status,'SENT');
  assert.equal(ok.state().sends[0].url,'/?section=inbox');
  for(const fixture of [workerFixture({session:null}),workerFixture({subscription:{version:4}}),workerFixture({subscription:{messages:false}})]){
    await fixture.worker.tick();
    assert.equal(fixture.state().sends.length,0);
    assert.equal(fixture.state().row.status,'CANCELLED');
  }
});
test('worker expires 404/410 subscriptions and preserves unknown send outcomes without replay',async()=>{
  for(const statusCode of [404,410]){
    const f=workerFixture({error:{statusCode}});
    await f.worker.tick();
    assert.equal(f.state().subscription.auth,'');
    assert.equal(f.state().row.status,'CANCELLED');
  }
  const unknown=workerFixture({error:new Error('secret response must never be recorded')});
  await unknown.worker.tick();
  await unknown.worker.tick();
  assert.equal(unknown.state().sends.length,1);
  assert.equal(unknown.state().row.status,'INDETERMINATE');
  assert.equal(unknown.state().row.lastError,'PUSH_TRANSPORT_ERROR');
  const reject=workerFixture({error:{statusCode:400}});
  await reject.worker.tick();
  assert.equal(reject.state().row.status,'FAILED');
});

test('controller uses authenticated cookie, body-only current endpoint and no-store responses', async t => {
  require('reflect-metadata');
  const { Module, UnauthorizedException } = require('@nestjs/common');
  const { NestFactory, Reflector } = require('@nestjs/core');
  const { RolesGuard } = load('..' + '/auth/roles.guard');
  class CookieGuard {
    canActivate(context) {
      const req=context.switchToHttp().getRequest();
      if(req.cookies?.yoleotard_crm_session!=='synthetic-session') throw new UnauthorizedException();
      req.user=user;
      return true;
    }
  }
  const calls=[];
  const push={
    config:async(actor,token,endpoint)=>{calls.push({actor,token,endpoint});return {enabled:true,publicKey:'public',subscription:endpoint?{topics:valid.topics}:null};},
    subscribe:async()=>({ok:true}),
    unsubscribe:async()=>({ok:true}),
  };
  class FakePushService {}
  const {WebPushController}=load('web-push.controller',{
    '../auth/session.guard':{SessionGuard:CookieGuard},
    '../auth/roles.guard':{RolesGuard},
    './web-push.service':{WebPushService:FakePushService},
  });
  Reflect.defineMetadata('design:paramtypes',[FakePushService],WebPushController);
  class TestModule {}
  Module({controllers:[WebPushController],providers:[CookieGuard,RolesGuard,Reflector,{provide:FakePushService,useValue:push}]})(TestModule);
  const app=await NestFactory.create(TestModule,{logger:false});
  app.use(require('cookie-parser')());
  app.setGlobalPrefix('api');
  await app.listen(0,'127.0.0.1');
  t.after(()=>app.close());
  const base=await app.getUrl();
  const headers={'Cookie':'yoleotard_crm_session=synthetic-session','Content-Type':'application/json'};
  assert.equal((await fetch(base+'/api/web-push/config')).status,401);
  const general=await fetch(base+'/api/web-push/config',{headers});
  assert.equal(general.headers.get('cache-control'),'no-store');
  assert.equal((await general.json()).subscription,null);
  const current=await fetch(base+'/api/web-push/subscriptions/current',{method:'POST',headers,body:JSON.stringify({endpoint:valid.endpoint})});
  assert.equal(current.status,201);
  assert.deepEqual((await current.json()).subscription,{topics:valid.topics});
  assert.equal(calls.at(-1).token,'synthetic-session');
  assert.equal(calls.at(-1).endpoint,valid.endpoint);
  const invalid=await fetch(base+'/api/web-push/subscriptions/current',{method:'POST',headers,body:'{}'});
  assert.equal(invalid.status,400);
  assert.equal((await invalid.json()).message,'Некорректная подписка уведомлений');
});

test('worker defers known provider rejection and quarantines expired processing without replay',async()=>{
  for(const statusCode of [429,503]){
    const retry=workerFixture({error:{statusCode}});
    await retry.worker.tick();
    assert.equal(retry.state().sends.length,1);
    assert.equal(retry.state().row.status,'PENDING');
    assert.ok(retry.state().row.availableAt>new Date());
  }
  const unknown=workerFixture({delivery:{status:'PROCESSING',lockedUntil:new Date(Date.now()-1000)}});
  await unknown.worker.tick();
  assert.equal(unknown.state().row.status,'INDETERMINATE');
  assert.equal(unknown.state().sends.length,0);
});

test('inbound push requires the matching raw provider timestamp and never the persistence fallback', () => {
  const timestamps = load('web-push-timestamp');
  const scope = { externalMessageId: 'mid-1', externalSenderId: 'customer', receiverId: 'page', channel: 'FACEBOOK' };
  const dm = stamp => ({ entry: [{ id: 'page', messaging: [{ sender: { id: 'customer' }, recipient: { id: 'page' }, message: { mid: 'mid-1' }, ...(stamp === undefined ? {} : { timestamp: stamp }) }] }] });
  for (const bad of [undefined, null, '', 'bad', false, 0, -1, Infinity, 1e30]) {
    assert.equal(timestamps.trustedInboundTimestamp('META', dm(bad), scope), null);
  }
  const ms = Date.parse('2026-11-17T10:05:00.000Z');
  assert.equal(timestamps.trustedInboundTimestamp('META', dm(ms), scope).toISOString(), '2026-11-17T10:05:00.000Z');
  const batch = dm(undefined);
  batch.entry[0].messaging.push({ sender: { id: 'someone-else' }, recipient: { id: 'page' }, message: { mid: 'different' }, timestamp: ms });
  assert.equal(timestamps.trustedInboundTimestamp('META', batch, scope), null, 'timestamp from another batch event cannot establish freshness');
  const waScope = { ...scope, channel: 'WHATSAPP', receiverId: 'phone' };
  const wa = stamp => ({ entry: [{ changes: [{ value: { metadata: { phone_number_id: 'phone' }, messages: [{ id: 'mid-1', from: 'customer', timestamp: stamp }] } }] }] });
  assert.equal(timestamps.trustedInboundTimestamp('META', wa(String(ms / 1000)), waScope).toISOString(), '2026-11-17T10:05:00.000Z');
  assert.equal(timestamps.trustedInboundTimestamp('META', wa('not-time'), waScope), null);
  const cwScope = { ...scope, externalMessageId: 'chatwoot:7:23', accountId: '7' };
  const cw = stamp => ({ event: 'message_created', id: 23, account: { id: 7 }, created_at: stamp });
  for (const bad of [undefined, null, '', false, 'invalid', 0, Infinity]) assert.equal(timestamps.trustedInboundTimestamp('CHATWOOT', cw(bad), cwScope), null);
  assert.equal(timestamps.trustedInboundTimestamp('CHATWOOT', cw(ms / 1000), cwScope).getTime(), ms);
  for (const createdAt of [String(ms / 1000), '2026-11-17T10:05:00.000Z', '2026-11-17T12:05:00+02:00']) {
    assert.equal(timestamps.trustedInboundTimestamp('CHATWOOT', cw(createdAt), cwScope).getTime(), ms);
  }
  assert.equal(timestamps.trustedInboundTimestamp('CHATWOOT', cw('2026-11-17T10:05:00'), cwScope), null);

  assert.equal(timestamps.trustedInboundTimestamp('CHATWOOT', { ...cw(ms / 1000), id: 24 }, cwScope), null);
  assert.equal(timestamps.trustedInboundTimestamp('EMAIL', {}, scope), null);
  assert.equal(timestamps.trustedInboundTimestamp('EMAIL', { pushSourceTimestamp: 'invalid' }, scope), null);
  assert.equal(timestamps.trustedEmailTimestamp(undefined, undefined), null);
  assert.equal(timestamps.trustedEmailTimestamp(new Date('invalid'), 'invalid'), null);
  const internal = new Date(ms);
  const email = timestamps.trustedEmailTimestamp(undefined, internal);
  assert.equal(email, '2026-11-17T10:05:00.000Z');
  assert.equal(timestamps.trustedInboundTimestamp('EMAIL', { pushSourceTimestamp: email }, scope).getTime(), ms);
});


test('actual Meta and Chatwoot persistence normalizers keep fallback dates while push excludes absent, invalid and historical source time', () => {
  const {normalizeMetaWebhook} = load('../communications/meta-webhook');
  const {normalizeChatwootWebhook} = load('../communications/chatwoot-webhook');
  const {trustedInboundTimestamp, trustedEmailTimestamp} = load('web-push-timestamp');
  const scope = { externalMessageId: 'mid', externalSenderId: 'customer', receiverId: 'page', channel: 'FACEBOOK' };
  const cutoff = Date.parse('2026-11-17T10:00:00Z');
  for (const timestamp of [undefined,'invalid',Date.parse('2020-01-01T00:00:00Z')]) {
    const payload={object:'page',entry:[{id:'page',messaging:[{sender:{id:'customer'},recipient:{id:'page'},timestamp,message:{mid:'mid',text:'synthetic'}}]}]};
    const normalized=normalizeMetaWebhook(payload)[0];
    assert.ok(normalized && Number.isFinite(normalized.receivedAt.getTime()),'message persistence keeps its valid arrival fallback');
    const proof=trustedInboundTimestamp('META',payload,normalized);
    assert.equal(Boolean(proof && proof.getTime()>=cutoff),false);
  }
  for (const created_at of [undefined,'invalid',1577836800]) {
    const payload={event:'message_created',message_type:'incoming',id:23,account:{id:7},sender:{id:'customer'},conversation:{id:1,contact_inbox:{source_id:'customer'}},content:'synthetic',created_at};
    const normalized=normalizeChatwootWebhook(payload)[0];
    assert.ok(normalized && Number.isFinite(normalized.receivedAt.getTime()),'Chatwoot persistence fallback is preserved');
    const proof=trustedInboundTimestamp('CHATWOOT',payload,normalized);
    assert.equal(Boolean(proof && proof.getTime()>=cutoff),false);
  }
  for(const providerDate of [undefined,new Date('invalid'),new Date('2020-01-01T00:00:00Z')]){
    const marker=trustedEmailTimestamp(providerDate,undefined);
    const proof=trustedInboundTimestamp('EMAIL',{pushSourceTimestamp:marker},scope);
    assert.equal(Boolean(proof && proof.getTime()>=cutoff),false);
  }
  const social={entry:[{id:'page',time:Date.now()/1000,changes:[{field:'feed',value:{item:'comment',comment_id:'comment',from:{id:'customer'}}}]}]};
  assert.equal(trustedInboundTimestamp('META',social,{...scope,externalMessageId:'comment'}),null,'fresh batch time cannot refresh an old comment without source time');
  social.entry[0].changes[0].value.created_time=1794909900;
  assert.equal(trustedInboundTimestamp('META',social,{...scope,externalMessageId:'comment'}).getTime(),1794909900000);
  social.entry[0].changes[0].value.created_time='2026-11-17T12:05:00+02:00';
  assert.equal(trustedInboundTimestamp('META',social,{...scope,externalMessageId:'comment'}).getTime(),Date.parse('2026-11-17T10:05:00Z'));
  social.entry[0].changes[0].value.created_time='invalid';
  assert.equal(trustedInboundTimestamp('META',social,{...scope,externalMessageId:'comment'}),null);

});

test('visible message and website purchase notifications use high delivery urgency',async()=>{
  for(const topic of ['messages','websiteOrders']){
    const fixture=workerFixture({delivery:{topic},subscription:{websiteOrders:true}});
    await fixture.worker.tick();
    await fixture.worker.tick();
    assert.deepEqual(fixture.state().urgencies,['high']);
    assert.equal(fixture.state().sends.length,1);
    assert.equal(fixture.state().row.status,'SENT');
  }
});
