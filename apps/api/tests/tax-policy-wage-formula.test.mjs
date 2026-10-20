import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTax } from './tax-service.test.mjs';
const { policyImpactPreview } = loadTax('tax-policy-preview.ts');
const math = loadTax('tax-math.ts');
const { TaxesService } = loadTax('taxes.service.ts');
const current = { id:'history', effectiveFrom:'2026-05-01', state:'PUBLISHED', group:3, unifiedMode:'PERCENT', unifiedRateBps:500, fixedUnifiedMinor:null, militaryRateBps:100, esvRateBps:2200, snapshot:{} };
const formula = { expectedRevision:2, effectiveFrom:'2027-01-01', group:2, unifiedMode:'FIXED', unifiedRateBps:0, fixedUnifiedMinor:null, fixedUnifiedWageRateBps:2000, militaryRateBps:1000, esvRateBps:2200, transitionEvidence:'Owner-approved future group transition; official wage unresolved' };
const now = new Date('2026-10-19T12:00:00Z');

test('future group2 January wage formula previews without an invented fixed sum and remains pending official basis', () => {
  const result = policyImpactPreview(formula,2,[current],[],now);
  assert.equal(result.publicationBlocked,false);
  assert.deepEqual(result.reasons.map(r=>r.code),['OFFICIAL_BASIS_PENDING']);
});

test('formula uses January wage for unified/military and month wage for ESV; unknown 2027 is never fabricated', () => {
  for (const component of ['UNIFIED','MILITARY','ESV']) assert.equal(math.monthlyAmount(component,'2027-01',formula).amountMinor,null);
  // Synthetic test-only evidence: not a statutory 2027 value and never persisted.
  const originalLength = math.WAGE_CATALOG.length;
  math.WAGE_CATALOG.push({version:'SYNTHETIC-JAN',from:'2027-01-01',to:'2027-02-01',minor:1000000,source:'synthetic-test',verifiedAt:'2027-01-01'}, {version:'SYNTHETIC-FEB',from:'2027-02-01',to:'2028-01-01',minor:1200000,source:'synthetic-test',verifiedAt:'2027-02-01'});
  try {
    assert.equal(math.monthlyAmount('UNIFIED','2027-02',formula).amountMinor,200000);
    assert.equal(math.monthlyAmount('MILITARY','2027-02',formula).amountMinor,100000);
    assert.equal(math.monthlyAmount('ESV','2027-02',formula).amountMinor,264000);
    assert.equal(math.monthlyAmount('UNIFIED','2027-02',{...formula,fixedUnifiedWageRateBps:1}).amountMinor,100);
  } finally { math.WAGE_CATALOG.splice(originalLength); }
});

function publicationStore() {
  const state={policies:[structuredClone(current)],config:{enabled:true,revision:2,accountingStartDate:'2026-05-01'},audits:[]};
  const tx={
    auditLog:{findFirst:async({where})=>state.audits.find(a=>a.requestId===where.requestId),create:async({data})=>{state.audits.push(data);return data}},
    appSetting:{upsert:async({update})=>{state.config=update.value;return update}},
    $queryRawUnsafe:async(sql,...args)=>{
      if(sql.includes('FROM "AppSetting"'))return [{value:state.config}];
      if(sql.includes('FROM "TaxPolicy"')){const all=state.policies.filter(p=>!sql.includes("state='PUBLISHED'")||p.state==='PUBLISHED');return sql.includes('"effectiveFrom"=$1')?all.filter(p=>p.effectiveFrom===args[0]):all;}
      if(sql.includes('FROM "TaxPeriod"'))return [];
      throw Error('Unexpected synthetic read');
    },
    $executeRawUnsafe:async(sql,...args)=>{
      if(sql.startsWith('INSERT INTO "TaxPolicy"')){const columns=/INSERT INTO "TaxPolicy"\(([^)]+)\)/.exec(sql)[1].split(',').map(s=>s.replaceAll('"',''));const row=Object.fromEntries(columns.map((name,i)=>[name,args[i]]));row.snapshot=JSON.parse(row.snapshot);row.state='PUBLISHED';row.createdAt=now;state.policies.push(row);}
      else assert.match(sql,/pg_advisory_xact_lock/);
      return 1;
    }
  };
  return {state,service:new TaxesService({$transaction:async(fn)=>fn(tx)},{} )};
}

test('authoritative future publication persists formula and immutable policy snapshots without resolving future wages',async()=>{
  const {state,service}=publicationStore(),prior=structuredClone(state.policies[0]);
  const command={...formula,operationKey:'synthetic-future-formula'};
  const saved=await service.publishPolicy(command,{id:'synthetic-owner',role:'OWNER'});
  assert.equal(saved.futurePolicies.length,1);
  assert.equal(saved.futurePolicies[0].fixedUnifiedMinor,null);
  assert.equal(saved.futurePolicies[0].fixedUnifiedWageRateBps,2000);
  assert.equal(saved.futurePolicies[0].snapshot.fixedUnifiedWageRateBps,2000);
  assert.equal(saved.futurePolicies[0].snapshot.officialBasisPending,true);
  assert.deepEqual(state.policies[0],prior);
  assert.equal(saved.revision,3);
  const replay=await service.publishPolicy(command,{id:'synthetic-owner',role:'OWNER'});
  assert.equal(JSON.stringify(replay),JSON.stringify(saved));assert.equal(state.policies.length,2);assert.equal(state.audits.length,1);
});

test('formula validation rejects ambiguous modes and sentinels; signatures bind the exact wage rate',async()=>{
  const invalid=[{fixedUnifiedWageRateBps:0},{fixedUnifiedWageRateBps:2001},{fixedUnifiedWageRateBps:-1},{fixedUnifiedWageRateBps:1.5},{fixedUnifiedMinor:0},{fixedUnifiedMinor:170000},{group:3,unifiedMode:'PERCENT',unifiedRateBps:500}];
  for(const change of invalid){
    const input={...formula,...change};assert.equal(policyImpactPreview(input,2,[current],[],now).publicationBlocked,true);
    await assert.rejects(new TaxesService({},{}).publishPolicy({...input,operationKey:'invalid-synthetic'},{id:'owner',role:'OWNER'}),error=>error.getStatus()===400);
  }
  const first=policyImpactPreview(formula,2,[current],[],now),changed=policyImpactPreview({...formula,fixedUnifiedWageRateBps:1000},2,[current],[],now);
  assert.notEqual(first.fieldSignature,changed.fieldSignature);
  assert.equal(policyImpactPreview({...formula,expectedRevision:1},2,[current],[],now).publicationBlocked,true);
  assert.equal(policyImpactPreview(formula,2,[current],[{month:'2027-01',state:'CLOSED',used:true,policyId:'used'}],now).publicationBlocked,true);
  assert.equal(policyImpactPreview({...formula,effectiveFrom:'2026-10-01'},2,[current],[],now).publicationBlocked,true);
});

test('2026 and legacy fixed policy math is unchanged; absent/new-null formula remain equivalent',async()=>{
  const legacy={group:2,unifiedMode:'FIXED',unifiedRateBps:0,fixedUnifiedMinor:170000,militaryRateBps:1000,esvRateBps:2200};
  assert.equal(math.monthlyAmount('UNIFIED','2026-12',legacy).amountMinor,170000);
  assert.equal(math.monthlyAmount('UNIFIED','2026-12',{...legacy,fixedUnifiedWageRateBps:null}).amountMinor,170000);
  assert.equal(math.monthlyAmount('MILITARY','2026-12',legacy).amountMinor,86470);
  assert.equal(math.monthlyAmount('ESV','2026-12',legacy).amountMinor,190234);
  assert.equal(math.monthlyAmount('ESV','2026-12',current).amountMinor,190234);
  assert.equal(math.monthlyAmount('UNIFIED','2027-01',legacy).amountMinor,null);
  for(const bad of [0,2001,-1,1.5])assert.equal(math.monthlyAmount('UNIFIED','2026-12',{...formula,fixedUnifiedWageRateBps:bad}).amountMinor,null);
  const {service}=publicationStore();const saved=await service.publishPolicy({...legacy,expectedRevision:2,operationKey:'legacy-future-fixed',effectiveFrom:'2027-01-01',transitionEvidence:'synthetic transition evidence'},{id:'owner',role:'OWNER'});
  assert.equal(saved.futurePolicies[0].fixedUnifiedMinor,170000);assert.equal(saved.futurePolicies[0].fixedUnifiedWageRateBps,null);
});

test('DTO accepts optional nullable formula but rejects zero, fractional and over20percent rates',async()=>{
  const { validate }=await import('class-validator');const {TaxPolicyDto,TaxPolicyPreviewDto}=loadTax('taxes.dto.ts');
  for(const Class of [TaxPolicyDto,TaxPolicyPreviewDto]){
    assert.equal((await validate(Object.assign(new Class(),{...formula,operationKey:'synthetic'}))).length,0);
    for(const fixedUnifiedWageRateBps of [0,2001,0.5,-1])assert.ok((await validate(Object.assign(new Class(),{...formula,operationKey:'synthetic',fixedUnifiedWageRateBps}))).some(e=>e.property==='fixedUnifiedWageRateBps'));
    assert.equal((await validate(Object.assign(new Class(),{...formula,operationKey:'synthetic',fixedUnifiedWageRateBps:null}))).length,0);
  }
});
