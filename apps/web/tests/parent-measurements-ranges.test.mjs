import assert from 'node:assert/strict';
import test from 'node:test';
import { rangeForDraft, rangeAcknowledgement, rangeWarnings, syncDraftRanges } from '../lib/parent-measurements-model.ts';

// Synthetic contract fixtures only. No measurement norms ship in runtime code.
const version='00000000-0000-4000-8000-000000000001';
const policy={version,rules:[
  {id:'generic',field:1,lowerCm:60,upperCm:80},
  {id:'specific',field:1,lowerCm:65,upperCm:75,discipline:'FIGURE_SKATING'},
  {id:'height',field:2,lowerCm:50,upperCm:70,minHeightCm:120,maxHeightCm:150},
]};
const draft={firstName:'Test',discipline:'FIGURE_SKATING',values:{m1:90},rangeVersion:version};

test('matching prefers exact sport, skips bounded rules without actual height, and keeps height optional',()=>{
  assert.equal(rangeForDraft(policy,draft,1)?.id,'specific');
  assert.equal(rangeForDraft(policy,{...draft,discipline:'OTHER'},1)?.id,'generic');
  assert.equal(rangeForDraft(policy,draft,2),undefined);
  assert.equal(rangeForDraft(policy,{...draft,heightCm:120},2)?.id,'height');
  assert.equal(rangeForDraft(policy,{...draft,heightCm:151},2),undefined);
  assert.equal(rangeForDraft({version:null,rules:[]},draft,1),undefined);
});

test('outside value can continue only with an explicit exact version/rule/field/half-cm acknowledgement',()=>{
  const warning=rangeWarnings(policy,draft)[0];
  assert.equal(warning.acknowledged,false);
  assert.equal(warning.code,`${version}:specific:m1:180`);
  assert.ok(warning.code.length<=80);
  assert.equal(rangeAcknowledgement(policy,policy.rules[1],1,90),warning.code);
  assert.equal(rangeWarnings(policy,{...draft,warningsAcknowledged:[warning.code]})[0].acknowledged,true);
  assert.equal(rangeWarnings(policy,{...draft,values:{m1:75}}).length,0);
});

test('editing a value invalidates acknowledgement even if the value is later changed back',()=>{
  const code=`${version}:specific:m1:180`;
  const acknowledged={...draft,warningsAcknowledged:[code]};
  const changed=syncDraftRanges({...acknowledged,values:{m1:90.5}},policy);
  assert.deepEqual(changed.warningsAcknowledged,[]);
  const restored=syncDraftRanges({...changed,values:{m1:90}},policy);
  assert.equal(rangeWarnings(policy,restored)[0].acknowledged,false);
  assert.deepEqual(acknowledged.values,{m1:90});
});

test('new or resumed draft receives active policy version without changing values and never reuses old-policy acknowledgements',()=>{
  const old={...draft,rangeVersion:'old-version',warningsAcknowledged:[`${version}:specific:m1:180`]};
  const current=syncDraftRanges(old,policy);
  assert.equal(current.rangeVersion,version);assert.deepEqual(current.values,{m1:90});
  assert.deepEqual(current.warningsAcknowledged,[]);
  const fresh=syncDraftRanges({firstName:'Test',values:{}},policy);
  assert.equal(fresh.rangeVersion,version);
  const disabled=syncDraftRanges(current,{version:null,rules:[]});
  assert.equal(disabled.rangeVersion,undefined);assert.deepEqual(disabled.values,{m1:90});
  assert.deepEqual(rangeWarnings(undefined,draft),[]);
  const baseline={firstName:'Test',values:{}};
  assert.equal(syncDraftRanges(baseline,undefined),baseline);
});
