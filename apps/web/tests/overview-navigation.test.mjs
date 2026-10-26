import test from 'node:test';
import assert from 'node:assert/strict';
import {createCrmNavigationHref,parseCrmSection} from '../lib/crm-sections.ts';
import {overviewTargets} from '../lib/overview-navigation.ts';
import {orderInitialTab,shipmentContextId} from '../lib/order-context.ts';
import {readFileSync} from 'node:fs';
test('new start page and exact target links survive reload without leaking stale context',()=>{
 assert.equal(parseCrmSection(undefined),'overview');
 const target=overviewTargets.message('c','dialog','INSTAGRAM');
 const href=createCrmNavigationHref(target.section,'?section=orders&orderId=old&tab=finance&period=2026-10&theme=light',target.context);
 const p=new URL(href,'https://crm.test').searchParams;
 assert.equal(p.get('section'),'inbox');assert.equal(p.get('clientId'),'c');assert.equal(p.get('conversationId'),'dialog');assert.equal(p.get('channel'),'INSTAGRAM');
 assert.equal(p.get('orderId'),null);assert.equal(p.get('tab'),null);assert.equal(p.get('period'),null);assert.equal(p.get('theme'),'light');
});
test('cash and expense links carry actual month and currency; shipment links select exact parcel without a mutation action',()=>{
 assert.deepEqual(overviewTargets.finance('2026-09','UAH','expenses'),{section:'finance',context:{period:'2026-09',currency:'UAH',tab:'expenses',metric:'received'}});
 const target=overviewTargets.shipment('o','parcel');const search='?'+new URLSearchParams(target.context);
 assert.equal(orderInitialTab(search,'o'),'delivery');assert.equal(shipmentContextId(search,'o'),'parcel');assert.equal(shipmentContextId(search,'other'),undefined);assert.equal(new URLSearchParams(search).has('action'),false);
});

test('recent orders show the server-classified source as a compact accessible icon',()=>{
 const workspace=readFileSync(new URL('../components/overview-workspace.tsx',import.meta.url),'utf8');
 const report=readFileSync(new URL('../lib/overview-report.ts',import.meta.url),'utf8');
 const css=readFileSync(new URL('../app/overview-workspace.css',import.meta.url),'utf8');
 assert.match(report,/recent:\{[^}]*orderSource:OrderSource/);
 assert.match(workspace,/<OverviewOrderSourceIcon source=\{order\.orderSource\}\/\>/);
 assert.match(workspace,/aria-label=\{sourceLabel\(source\)\}/);
 assert.match(css,/\.overview-order-source\{[^}]*width:22px;height:22px/);
});
