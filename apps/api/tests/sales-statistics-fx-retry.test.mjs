import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule} from './overview-target-loader.mjs';
const {SalesStatisticsFx}=loadTargetModule('overview/sales-statistics-fx.ts');
const BASE=Date.parse('2026-11-02T10:00:00Z');
const event=(day='2020-07-07')=>({currency:'USD',date:day+'T10:00:00Z',amountMinor:10000});
const input=events=>({provider:'NBU',currency:'EUR',events});
const row=(cc,day='07.07.2020',rate=cc==='EUR'?'50':'40')=>({cc,exchangedate:day,units:1,rate:999,rate_per_unit:rate});
const converted=(fx,day='2020-07-07')=>fx.convert(10000,'USD',day+'T10:00:00Z');

test('same FX instance retries missing observations after 30 seconds and preserves complete positive memo',async()=>{
  let clock=BASE,recovered=false;const calls=[];
  const fx=new SalesStatisticsFx(async url=>{
    calls.push(url);const cc=new URL(url).searchParams.get('valcode').toUpperCase();
    return new Response(JSON.stringify(recovered?[row(cc)]:[]));
  },()=>new Date(clock));
  const request=input([event()]);
  assert.equal(converted(await fx.prepare(request)),null);assert.equal(calls.length,2);
  recovered=true;clock=BASE+29000;
  assert.equal(converted(await fx.prepare(request)),null);assert.equal(calls.length,2,'missing result has a bounded negative memo');
  clock=BASE+31000;
  assert.equal(converted(await fx.prepare(request)),8000,'same instance must observe the recovered provider');
  assert.equal(calls.length,4);
  clock+=31000;
  assert.equal(converted(await fx.prepare(request)),8000);assert.equal(calls.length,4,'complete positive historical data keeps its normal TTL');
  clock=BASE+31000+30*60000-1;
  assert.equal(converted(await fx.prepare(request)),8000);assert.equal(calls.length,4);
  clock++;
  assert.equal(converted(await fx.prepare(request)),8000);assert.equal(calls.length,6,'positive memo still expires at 30 minutes');
});

test('blocked observations fail closed then retry only the blocked leg after 31 seconds',async()=>{
  let clock=BASE,recovered=false;const calls=[];
  const fx=new SalesStatisticsFx(async url=>{
    calls.push(url);const cc=new URL(url).searchParams.get('valcode').toUpperCase();
    const rows=cc==='EUR'&&!recovered?[row(cc),row(cc,'07.07.2020','51')]:[row(cc)];
    return new Response(JSON.stringify(rows));
  },()=>new Date(clock));
  const request=input([event()]);
  assert.equal(converted(await fx.prepare(request)),null);assert.equal(calls.length,2);
  recovered=true;clock+=31000;
  assert.equal(converted(await fx.prepare(request)),8000);assert.equal(calls.length,3,'complete USD leg retains its positive memo');
  assert.ok(calls.at(-1).includes('valcode=eur'));
});

test('memo completeness follows current required event days without expiring complete sparse historical ranges',async()=>{
  let clock=BASE,recovered=false;const calls=[];
  const fx=new SalesStatisticsFx(async url=>{
    calls.push(url);const cc=new URL(url).searchParams.get('valcode').toUpperCase();
    const days=cc==='EUR'&&!recovered?['06.07.2020','08.07.2020']:['06.07.2020','07.07.2020','08.07.2020'];
    return new Response(JSON.stringify(days.map(day=>row(cc,day))));
  },()=>new Date(clock));
  const sparse=input([event('2020-07-06'),event('2020-07-08')]);
  assert.equal(converted(await fx.prepare(sparse),'2020-07-06'),8000);assert.equal(calls.length,2);
  clock+=31000;
  assert.equal(converted(await fx.prepare(sparse),'2020-07-08'),8000);assert.equal(calls.length,2,'an unrequested gap is not a negative observation');
  recovered=true;
  const extended=input([...sparse.events,event()]);
  assert.equal(converted(await fx.prepare(extended)),8000);
  assert.equal(calls.length,3,'same URL retries the newly needed missing day while retaining the complete other leg');
});
