import assert from 'node:assert/strict';
import test from 'node:test';
import {createVisibilityPolling} from '../lib/visibility-polling.ts';

const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function browser(t,hidden=false){
 t.mock.timers.enable({apis:['setTimeout','Date'],now:1000});
 const doc=new EventTarget();doc.hidden=hidden;
 const win=new EventTarget();
 const oldDoc=globalThis.document,oldWin=globalThis.window;
 globalThis.document=doc;globalThis.window=win;
 return {restore(){globalThis.document=oldDoc;globalThis.window=oldWin},doc,win,async tick(ms){t.mock.timers.tick(ms);await flush()},visibility(hidden){doc.hidden=hidden;doc.dispatchEvent(new Event('visibilitychange'))},focus(){win.dispatchEvent(new Event('focus'))}};
}

test('visible badges refresh on mount then every 15 seconds after completion',async t=>{
 const b=browser(t);let calls=0;
 const p=createVisibilityPolling(async()=>{calls++});t.after(()=>{p.stop();b.restore()});
 await flush();assert.equal(calls,1);
 await b.tick(14999);assert.equal(calls,1);
 await b.tick(1);assert.equal(calls,2);
});

test('hidden mount is quiet; resume and focus coalesce and hidden pages pause',async t=>{
 const b=browser(t,true);let calls=0;
 const p=createVisibilityPolling(async()=>{calls++});t.after(()=>{p.stop();b.restore()});
 await b.tick(60000);assert.equal(calls,0);
 b.visibility(false);b.focus();await flush();b.focus();await flush();assert.equal(calls,1);
 b.visibility(true);await b.tick(60000);assert.equal(calls,1);
 b.focus();await flush();assert.equal(calls,1);
 b.visibility(false);await flush();assert.equal(calls,2);
});

test('slow requests never overlap; explicit refresh during a request queues one recovery read',async t=>{
 const b=browser(t);const pending=[];let calls=0,active=0,maxActive=0;
 const p=createVisibilityPolling(async()=>{calls++;active++;maxActive=Math.max(maxActive,active);await new Promise(resolve=>pending.push(resolve));active--});t.after(()=>{p.stop();b.restore()});
 await b.tick(60000);b.focus();b.visibility(true);b.visibility(false);await flush();assert.equal(calls,1);
 p.refresh();p.refresh();await flush();assert.equal(calls,1);
 pending.shift()();await flush();assert.equal(calls,2);assert.equal(maxActive,1);
 pending.shift()();await flush();await b.tick(14999);assert.equal(calls,2);
 await b.tick(1);assert.equal(calls,3);pending.shift()();await flush();
});

test('failures back off 30/60/120s, cap at 120s, and success restores 15s',async t=>{
 const b=browser(t);let calls=0,fail=true;
 const p=createVisibilityPolling(async()=>{calls++;if(fail)throw Error('offline')});t.after(()=>{p.stop();b.restore()});
 await flush();assert.equal(calls,1);
 for(const delay of [30000,60000,120000,120000]){
  const previous=calls;await b.tick(delay-1);assert.equal(calls,previous);
 await b.tick(1);assert.equal(calls,previous+1);
 }
 fail=false;await b.tick(250);b.focus();await flush();assert.equal(calls,6);
 await b.tick(15000);assert.equal(calls,7);
});

test('stop removes listeners and delayed retries, including after an in-flight settlement',async t=>{
 const b=browser(t);t.after(()=>b.restore());let calls=0,resolve;
 const p=createVisibilityPolling(async()=>{calls++;await new Promise(r=>resolve=r)});
 p.refresh(1000);p.stop();resolve();await flush();
 b.focus();b.visibility(true);b.visibility(false);p.refresh();await b.tick(180000);
 assert.equal(calls,1);
 const q=createVisibilityPolling(async()=>{calls++});await flush();q.refresh(1000);q.stop();await b.tick(180000);assert.equal(calls,2);
});

test('focus followed by visibility after a fast response still refreshes only once',async t=>{
 const b=browser(t);let calls=0;
 const p=createVisibilityPolling(async()=>{calls++});t.after(()=>{p.stop();b.restore()});
 await flush();b.visibility(true);await b.tick(1000);
 b.doc.hidden=false;b.focus();await flush();b.doc.dispatchEvent(new Event('visibilitychange'));await flush();
 assert.equal(calls,2);
});

test('reported failures back off independently; hidden delayed retries recover on resume',async t=>{
 const b=browser(t);let unread=0,website=0;
 const p=createVisibilityPolling(async()=>{unread++;return false});
 const q=createVisibilityPolling(async()=>{website++});t.after(()=>{p.stop();q.stop();b.restore()});
 await flush();await b.tick(15000);assert.deepEqual([unread,website],[1,2]);
 await b.tick(15000);assert.deepEqual([unread,website],[2,3]);
 q.refresh(1000);b.visibility(true);await b.tick(120000);assert.deepEqual([unread,website],[2,3]);
 b.visibility(false);b.focus();await flush();assert.deepEqual([unread,website],[3,4]);
});

test('a quick hide/resume cannot strand a recently completed poll without a timer',async t=>{
 const b=browser(t);let calls=0;
 const p=createVisibilityPolling(async()=>{calls++});t.after(()=>{p.stop();b.restore()});
 await flush();b.visibility(true);await b.tick(100);b.visibility(false);b.focus();await flush();
 await b.tick(150);assert.equal(calls,2);
 await b.tick(15000);assert.equal(calls,3);
});
