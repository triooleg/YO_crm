import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
const controller=await readFile(new URL("../src/orders/order-tabs.controller.ts",import.meta.url),"utf8");
const service=await readFile(new URL("../src/orders/order-tabs.service.ts",import.meta.url),"utf8");

test("order tab endpoints require session and role guards",()=>{
  assert.match(controller,/@UseGuards\(SessionGuard,RolesGuard\)/);
  for(const route of ["notes","tags","instances","files","preferences"])assert.match(controller,new RegExp(route));
  assert.match(controller,/@Roles\(UserRole\.OWNER,UserRole\.ADMIN/);
  const routes = controller.split(/(?=@(?:Get|Post|Patch|Delete)\()/).slice(1);
  const measurement = routes.find(route => route.startsWith('@Post(":orderId/instances/:instanceId/measurement")'));
  assert.match(measurement, /@Roles\(UserRole\.OWNER,UserRole\.ADMIN,UserRole\.MANAGER,UserRole\.PRODUCTION\)/);
  for (const route of routes.filter(route => route !== measurement)) assert.doesNotMatch(route, /UserRole\.PRODUCTION/);
});
test("notes preserve revisions and archive instead of deleting",()=>{
  assert.match(service,/orderNoteRevision\.create/);
  assert.match(service,/archivedAt:new Date\(\)/);
  assert.doesNotMatch(service,/orderNote\.delete/);
  assert.match(service,/expectedUpdatedAt/);
});
test("tags are archived with audit history instead of hard deleted",()=>{
  assert.match(service,/orderTag\.update\(\{where:\{id:tagId\},data:\{archivedAt:new Date\(\)\}\}\)/);
  assert.doesNotMatch(service,/orderTag\.delete/);
  assert.match(service,/entityType:"OrderTag"/);
});
test("instance mutations enforce order client athlete and measurement ownership",()=>{
  assert.match(service,/orderItem:\{orderId\}/);
  assert.match(service,/clientId:current\.orderItem\.order\.clientId/);
  assert.match(service,/if\(measurementId&&!athleteId\)throw new ConflictException\("Сначала выберите спортсмена"\)/);
  assert.match(service,/where:\{id:measurementId,athleteId:athleteId!\}/);
  assert.match(service,/Спортсмен не принадлежит клиенту заказа/);
  assert.match(service,/Снимок мерок не принадлежит выбранному спортсмену/);
  assert.match(service,/aggregateProductionStatus/);
  assert.match(service,/productionStatus:dto\.productionStatus/);
  assert.doesNotMatch(service,/plannedStartAt|plannedEndAt/);
});
test("order tab mutations write activity or audit history",()=>{
  assert.match(service,/ORDER_NOTE_CREATED/);
  assert.match(service,/ORDER_ITEM_INSTANCE_UPDATED/);
  assert.match(service,/auditLog\.create/);
  assert.match(service,/actorId:user\.id/);
});
test("client preferences use an atomic optimistic concurrency claim",()=>{
  assert.match(service,/client\.updateMany\(\{where:\{id:clientId,archivedAt:null,updatedAt:expectedUpdatedAt\}/);
  assert.match(service,/claimed\.count!==1/);
  assert.doesNotMatch(service,/client\.update\(\{where:\{id:clientId\}/);
});
test("file role changes use optimistic concurrency instead of silent overwrite",()=>{
  assert.match(service,/orderFile\.updateMany\(\{where:\{id:fileId,orderId,role:dto\.expectedRole,orderItemId:dto\.expectedOrderItemId\?\?null,noteId:dto\.expectedNoteId\?\?null\}/);
  assert.match(service,/Файл уже изменён другим пользователем/);
});
