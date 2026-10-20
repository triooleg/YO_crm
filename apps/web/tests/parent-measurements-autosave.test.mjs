import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftAutosave } from '../lib/parent-measurements-autosave.ts';

test('edits during an in-flight save serialize with the returned revision and retain the latest draft', async () => {
  const requests=[]; let resolve;
  const save=new DraftAutosave(4,async(revision,draft)=>{requests.push({revision,draft});if(requests.length===1)await new Promise(r=>resolve=r);return {revision:revision+1};},()=>{},10000);
  save.edit({value:70});const pending=save.flush();
  save.edit({value:71});resolve();await pending;
  assert.deepEqual(requests,[{revision:4,draft:{value:70}},{revision:5,draft:{value:71}}]);
  assert.equal(save.revision,6);assert.equal(save.state,'saved');save.dispose();
});

test('CAS conflict stops all retries and keeps unsaved changes until explicit server reload',async()=>{
  let attempts=0;
  const save=new DraftAutosave(3,async()=>{attempts++;throw Object.assign(new Error(),{status:409});},()=>{},10000);
  save.edit({value:70});await assert.rejects(save.flush());
  save.edit({value:71});await assert.rejects(save.flush());
  assert.equal(attempts,1);assert.equal(save.state,'conflict');assert.equal(save.dirty,true);save.dispose();
});

test('offline failure never reports saved; an explicit retry keeps the same expected revision',async()=>{
  let connected=false;const revisions=[];
  const save=new DraftAutosave(2,async(revision)=>{revisions.push(revision);if(!connected)throw new TypeError('offline');return {revision:3};},()=>{},10000);
  save.edit({value:70});await assert.rejects(save.flush());assert.equal(save.state,'error');assert.equal(save.dirty,true);
  connected=true;await save.flush();assert.deepEqual(revisions,[2,2]);assert.equal(save.dirty,false);save.dispose();
});
