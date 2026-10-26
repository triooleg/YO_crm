import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const schema=await readFile(new URL('../../../packages/database/prisma/schema.prisma',import.meta.url),'utf8');
const service=await readFile(new URL('../src/orders/orders.service.ts',import.meta.url),'utf8');
const controller=await readFile(new URL('../src/orders/orders.controller.ts',import.meta.url),'utf8');
const ingress=await readFile(new URL('../src/website-orders/website-orders.service.ts',import.meta.url),'utf8');
const listModel=await readFile(new URL('../src/orders/order-list-read-model.ts',import.meta.url),'utf8');

test('new website orders persist reviewable notices and expose role-protected read endpoints',()=>{
 assert.match(schema,/websiteNoticeAt\s+DateTime\?/);assert.match(schema,/websiteReviewedAt\s+DateTime\?/);
 assert.match(ingress,/websiteNoticeAt:new Date\(\)/);
 assert.match(controller,/@Get\("website-notifications"\)/);assert.match(controller,/@Post\(":id\/website-notification\/read"\)/);
 assert.match(service,/archivedAt:\s*null,\s*websiteNoticeAt:\s*\{\s*not:\s*null\s*\},\s*websiteReviewedAt:\s*null/);
 assert.match(service,/async reviewWebsiteNotification/);assert.match(service,/tx\.auditLog\.create/);
});

test('order KPIs and website source totals are built only from the active server query',()=>{
 assert.match(service,/const where:Prisma\.OrderWhereInput=\{ archivedAt: null/);
 assert.match(listModel,/const sourceCounts=ORDER_SOURCES\.map\(source=>\(\{source,count:unique\.filter/);
 assert.match(listModel,/unique=\[\.\.\.new Map\(records\.map/);
});
