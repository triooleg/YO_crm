import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';

const {guardHistoryNativeEvent,classifyHistoryNativeEvent}=loadTargetModule('history-migration/history-native-reconciliation.ts');
const event=(changes={})=>({conversationId:'conversation',channel:'INSTAGRAM',accountId:'receiver',customerId:'customer',
  provider:'META',nativeMessageId:'mid',direction:'INBOUND',originalTimestamp:'2024-01-01T12:31:00.000Z',
  rawPayload:{message:{mid:'mid',text:'Synthetic payload'}},envelope:{body:'Complete synthetic envelope',headers:{signature:'synthetic'}},...changes});
const binding=(changes={})=>({kind:'PROTECTED',conversationId:'conversation',channel:'INSTAGRAM',accountId:'receiver',customerId:'customer',runId:'run',status:'APPLIED',...changes});
const window=(changes={})=>({version:1,conversationId:'conversation',channel:'INSTAGRAM',accountId:'receiver',customerId:'customer',
  runId:'run',status:'APPLIED',archiveStartAt:'2024-01-01T12:00:00.000Z',cutoffAt:'2024-01-01T12:31:00.000Z',...changes});
const classify=(native,archive)=>classifyHistoryNativeEvent(native,binding(),archive);

test('pure classifier holds inbound and echo through the last archive minute; only later originals pass',()=>{
  for(const direction of ['INBOUND','OUTBOUND']){
    for(const originalTimestamp of ['2024-01-01T11:59:00.000Z','2024-01-01T12:30:00.000Z','2024-01-01T12:30:59.999Z'])
      assert.deepEqual(classify(event({direction,originalTimestamp}),window()),{action:'REVIEW',reason:'BEFORE_CUTOFF'});
    for(const originalTimestamp of ['2024-01-01T12:31:00.000Z','2099-01-01T00:00:00.000Z'])
      assert.deepEqual(classify(event({direction,originalTimestamp}),window()),{action:'PASS',reason:'AT_OR_AFTER_CUTOFF'});
    for(const originalTimestamp of [null,'','yesterday','2024-01-01','2024-02-30T12:31:00.000Z','2024-01-01T12:31:00'])
      assert.deepEqual(classify(event({direction,originalTimestamp}),window()),{action:'REVIEW',reason:'UNKNOWN_ORIGINAL_TIME'});
  }
});

test('same-conversation mismatches and invalid windows fail closed even for later events; rollback retains hold',()=>{
  for(const key of ['conversationId','channel','accountId','customerId'])
    assert.deepEqual(classify(event(),window({[key]:'foreign'})),{action:'REVIEW',reason:'SCOPE_MISMATCH'});
  for(const changes of [{runId:''},{version:2},{status:'DELETED'},{cutoffAt:'2024-01-01T12:30:59.999Z'},
    {archiveStartAt:'2024-01-01T13:00:00.000Z'},{accountId:null}])
    assert.deepEqual(classify(event(),window(changes)),{action:'REVIEW',reason:'INVALID_WINDOW'});
  assert.deepEqual(classify(event({originalTimestamp:null}),window({status:'ROLLED_BACK'})),{action:'REVIEW',reason:'UNKNOWN_ORIGINAL_TIME'});
  assert.deepEqual(classify(event({originalTimestamp:'2024-01-01T12:30:00.000Z'}),window({status:'ROLLED_BACK'})),{action:'REVIEW',reason:'BEFORE_CUTOFF'});
});

test('independent run authority distinguishes absent binding from a deleted or corrupt window',()=>{
  assert.deepEqual(classifyHistoryNativeEvent(event(),{kind:'NONE'},null),{action:'PASS',reason:'NO_BINDING'});
  for(const status of ['APPLIED','ROLLED_BACK']){
    assert.deepEqual(classifyHistoryNativeEvent(event(),binding({status}),null),{action:'REVIEW',reason:'MISSING_WINDOW'});
    assert.deepEqual(classifyHistoryNativeEvent(event(),binding({status}),{}),{action:'REVIEW',reason:'INVALID_WINDOW'});
    assert.deepEqual(classifyHistoryNativeEvent(event(),binding({status}),window({runId:'other-run'})),{action:'REVIEW',reason:'SCOPE_MISMATCH'});
  }
  for(const invalid of [null,undefined,{},binding({status:'FAILED'}),binding({runId:''}),{kind:'NONE',runId:'still-protected'}])
    assert.deepEqual(classifyHistoryNativeEvent(event(),invalid,null),{action:'REVIEW',reason:'INVALID_BINDING'});
});

test('ordinary conversation locks before reading and has no review side effects',async()=>{
  const calls=[];
  const storage={
    async $executeRaw(strings,...values){calls.push(['lock',strings.join('?'),values]);},
    async loadBinding(id){calls.push(['binding',id]);return {kind:'NONE'};},
    async loadWindow(){assert.fail('no operational binding means no window lookup');},
    async insertReviewAndEnvelope(){assert.fail('ordinary messages must not enter review');},
  };
  assert.deepEqual(await guardHistoryNativeEvent(storage,event()),{action:'PASS',reason:'NO_BINDING'});
  assert.equal(calls.length,2);assert.match(calls[0][1],/pg_advisory_xact_lock_shared/);
  assert.deepEqual(calls[0][2],['history-conversation:conversation']);assert.deepEqual(calls[1],['binding','conversation']);
});

function reviewStorage(bound=binding(),archive=window()){
  const rows=new Map(),calls=[];
  return {rows,calls,
    async $executeRaw(strings,...values){calls.push(['lock',values[0]]);},
    async loadBinding(id){calls.push(['binding',id]);return bound;},
    async loadWindow(value){calls.push(['window',value.runId]);return archive;},
    async insertReviewAndEnvelope(input){
      calls.push(['persist',input.reviewKey]);
      const previous=rows.get(input.reviewKey);if(previous)return {id:previous.id,created:false};
      const id='review-'+(rows.size+1);rows.set(input.reviewKey,{id,...structuredClone(input)});return {id,created:true};
    },
  };
}

test('guard durably retains full inbound/echo payload and envelope, exact retries noop and conflicting variants survive',async()=>{
  for(const direction of ['INBOUND','OUTBOUND']){
    const storage=reviewStorage(),native=event({direction,originalTimestamp:null});
    const first=await guardHistoryNativeEvent(storage,native);
    assert.deepEqual(first,{action:'REVIEW',reason:'UNKNOWN_ORIGINAL_TIME',reviewId:'review-1',created:true});
    const retained=[...storage.rows.values()][0];
    assert.deepEqual(JSON.parse(retained.eventJson),native);assert.equal(retained.runId,'run');
    assert.deepEqual(JSON.parse(retained.bindingJson),binding());assert.deepEqual(JSON.parse(retained.windowJson),window());
    const before=structuredClone([...storage.rows]);
    assert.deepEqual(await guardHistoryNativeEvent(storage,structuredClone(native)),{...first,created:false});
    assert.deepEqual([...storage.rows],before,'exact retries must not overwrite first evidence');
    const changed=event({direction,originalTimestamp:null,rawPayload:{message:{mid:'mid',text:'Conflicting payload'}}});
    const second=await guardHistoryNativeEvent(storage,changed);assert.equal(second.reviewId,'review-2');assert.equal(storage.rows.size,2);
    assert.notEqual([...storage.rows.values()][0].payloadHash,[...storage.rows.values()][1].payloadHash);
    assert.deepEqual(storage.calls.slice(0,3),[['lock','history-conversation:conversation'],['binding','conversation'],['window','run']]);
  }
});

test('protected missing/corrupt/foreign windows durably review even future events without a writer feature flag',async()=>{
  for(const [archive,reason] of [[null,'MISSING_WINDOW'],[{},'INVALID_WINDOW'],[window({accountId:'foreign'}),'SCOPE_MISMATCH']]){
    const storage=reviewStorage(binding({status:'ROLLED_BACK'}),archive);
    const result=await guardHistoryNativeEvent(storage,event({originalTimestamp:'2099-01-01T00:00:00.000Z'}));
    assert.equal(result.action,'REVIEW');assert.equal(result.reason,reason);assert.equal(storage.rows.size,1);
  }
});

test('scoped MIDs never coalesce foreign accounts, customers, channels, providers or directions',async()=>{
  const storage=reviewStorage();
  for(const changes of [{},{accountId:'foreign'},{customerId:'foreign'},{channel:'FACEBOOK'},{provider:'CHATWOOT'},{direction:'OUTBOUND'},{nativeMessageId:'other'}])
    assert.equal((await guardHistoryNativeEvent(storage,event({originalTimestamp:null,...changes}))).created,true);
  assert.equal(storage.rows.size,7);assert.equal(new Set([...storage.rows.values()].map(r=>r.scopeKey)).size,7);
});

test('no binding/window read can precede the shared lock or miss an importer commit while waiting',async()=>{
  const storage=reviewStorage();let release,started,published=false;
  const locking=new Promise(resolve=>{started=resolve;});
  const exclusive=new Promise(resolve=>{release=resolve;});
  storage.$executeRaw=async(strings,...values)=>{storage.calls.push(['lock',values[0]]);started();await exclusive;};
  storage.loadBinding=async()=>{storage.calls.push(['binding']);return published?binding():{kind:'NONE'};};
  const pending=guardHistoryNativeEvent(storage,event({originalTimestamp:null}));await locking;
  assert.deepEqual(storage.calls,[['lock','history-conversation:conversation']]);assert.equal(storage.rows.size,0);
  // The importer publishes its independent run and sealed window before release.
  published=true;release();assert.equal((await pending).action,'REVIEW');assert.equal(storage.rows.size,1);
});

test('scope is captured before waiting so mutable caller input cannot switch the locked conversation',async()=>{
  const storage=reviewStorage(),native=event({originalTimestamp:null});let release;
  storage.$executeRaw=async()=>new Promise(resolve=>{release=resolve;});
  const pending=guardHistoryNativeEvent(storage,native);native.conversationId='foreign';native.accountId='foreign';release();
  assert.equal((await pending).reason,'UNKNOWN_ORIGINAL_TIME');
  const retained=[...storage.rows.values()][0];assert.equal(retained.conversationId,'conversation');
  assert.equal(JSON.parse(retained.eventJson).accountId,'receiver');
});

test('lock, authority lookup, evidence authentication and persistence failures never acknowledge or pass an event',async()=>{
  for(const failed of ['$executeRaw','loadBinding','loadWindow','insertReviewAndEnvelope']){
    const storage=reviewStorage();storage[failed]=async()=>{throw Error('Synthetic storage refusal');};
    await assert.rejects(guardHistoryNativeEvent(storage,event({originalTimestamp:null})),/Synthetic storage refusal/);
    assert.equal(storage.rows.size,0);
  }
  const storage=reviewStorage();storage.insertReviewAndEnvelope=async()=>null;
  await assert.rejects(guardHistoryNativeEvent(storage,event({originalTimestamp:null})),/REVIEW_NOT_PERSISTED/);
});

test('full evidence keeps byte-bearing strings and JSON keys; non-JSON evidence is refused without truncation',async()=>{
  const storage=reviewStorage(),native=event({originalTimestamp:null,
    rawPayload:JSON.parse('{"__proto__":{"retained":true},"unicode":"Фото 😀","bytes":" a\\r\\n b "}')});
  await guardHistoryNativeEvent(storage,native);
  assert.deepEqual(JSON.parse([...storage.rows.values()][0].eventJson).rawPayload,native.rawPayload);
  const first=[...storage.rows];
  await guardHistoryNativeEvent(storage,{...native,rawPayload:{bytes:' a\r\n b ',unicode:'Фото 😀',['__proto__']:{retained:true}}});
  assert.deepEqual([...storage.rows],first,'object key order alone is an exact retry');
  const circular={};circular.self=circular;
  for(const rawPayload of [undefined,NaN,BigInt(1),{dropped:undefined},new Date(),circular,Array(2),{toJSON:()=>({})}]){
    await assert.rejects(guardHistoryNativeEvent(storage,event({originalTimestamp:null,rawPayload})),/EVIDENCE_NOT_JSON/);
    assert.deepEqual([...storage.rows],first);
  }
});

test('later events have no review effects; caller-provided duplicate flags cannot bypass the protected guard',async()=>{
  const storage=reviewStorage();
  assert.deepEqual(await guardHistoryNativeEvent(storage,event()),{action:'PASS',reason:'AT_OR_AFTER_CUTOFF'});
  assert.equal(storage.rows.size,0);
  assert.equal((await guardHistoryNativeEvent(storage,event({originalTimestamp:null,knownNativeMessageId:true}))).action,'REVIEW');
});
