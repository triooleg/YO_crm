import test from 'node:test';
import assert from 'node:assert/strict';
import {loadTargetModule as load} from './overview-target-loader.mjs';
const {TasksService}=load('tasks/tasks.service.ts');
const {TasksController}=load('tasks/tasks.controller.ts');
test('task detail retains exactly the existing board read roles',()=>{
 assert.deepEqual(Reflect.getMetadata('roles',TasksController.prototype.detail),Reflect.getMetadata('roles',TasksController.prototype.board));
 assert.deepEqual(Reflect.getMetadata('roles',TasksController.prototype.detail),['OWNER','ADMIN','MANAGER','PRODUCTION']);
});
test('task detail resolves an active exact id without initializing columns or writing',async()=>{
 const task={id:'exact',attachments:[],assignee:{id:'me'}};
 const service=new TasksService({workTask:{findFirst:async query=>{
  assert.deepEqual(query.where,{id:'exact',archivedAt:null,column:{archivedAt:null}});assert.ok(query.include.attachments);return task;
 }}});
 assert.equal(await service.detail('exact'),task);
});
test('missing or archived task detail is explicit 404',async()=>{
 const service=new TasksService({workTask:{findFirst:async()=>null}});
 await assert.rejects(()=>service.detail('missing'),error=>error.getStatus()===404&&error.message==='Задача не найдена');
});
