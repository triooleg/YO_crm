import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const schema=await readFile(new URL("../../../packages/database/prisma/schema.prisma",import.meta.url),"utf8");
const app=await readFile(new URL("../src/app.module.ts",import.meta.url),"utf8");
const controller=await readFile(new URL("../src/tasks/tasks.controller.ts",import.meta.url),"utf8").catch(()=>"");
const service=await readFile(new URL("../src/tasks/tasks.service.ts",import.meta.url),"utf8").catch(()=>"");

test("kanban tasks persist columns, assignee, source message and attachments",()=>{
  assert.match(schema,/model TaskColumn/);
  assert.match(schema,/model WorkTask/);
  assert.match(schema,/model TaskAttachment/);
  assert.match(schema,/sourceMessageId\s+String\?/);
  assert.match(schema,/assigneeId\s+String\?/);
  assert.match(schema,/labels\s+String\[\]/);
  assert.match(schema,/markerColor\s+String/);
  assert.match(schema,/dueAt\s+DateTime\?/);
});

test("tasks module exposes protected board, mutations, incoming picker and images",()=>{
  assert.match(app,/TasksController/);
  assert.match(app,/TasksService/);
  assert.match(controller,/@UseGuards\(SessionGuard,\s*RolesGuard\)/);
  assert.match(controller,/@Get\("board"\)/);
  assert.match(controller,/@Get\("incoming"\)/);
  assert.match(controller,/@Post\("images"\)/);
  assert.match(controller,/@Patch\(":id\/move"\)/);
  assert.match(controller,/@Post\("columns"\)/);
});

test("task creation validates source message client and assignee and audits changes",()=>{
  assert.match(service,/direction:\s*"INBOUND"/);
  assert.match(service,/sourceMessageId/);
  assert.match(service,/assignee.*active:\s*true/s);
  assert.match(service,/entityType:\s*"WorkTask"/);
  assert.match(service,/TASK_CREATED/);
  assert.match(service,/TASK_MOVED/);
  assert.match(service,/\$transaction/);
});

test("task photos use persistent uploads and bounded image processing",()=>{
  assert.match(service,/uploadsRoot\(\)/);
  assert.match(service,/task-images/);
  assert.match(service,/MAX_SOURCE_BYTES/);
  assert.match(service,/sharp\(/);
  assert.match(controller,/sendFile/);
});

test("columns archive instead of deleting task history",()=>{
  assert.match(schema,/archivedAt\s+DateTime\?/);
  assert.match(service,/TASK_COLUMN_ARCHIVED/);
  assert.doesNotMatch(controller,/@Delete/);
});

test("task ordering is serialized and sibling positions are normalized",()=>{
  assert.match(service,/pg_advisory_xact_lock\(hashtext\('tasks-kanban'\)\)/);
  assert.match(service,/target\.splice\(requested,\s*0,\s*\{ id \}\)/);
  assert.match(service,/for \(const \[position, item\] of target\.entries\(\)\)/);
  assert.match(service,/for \(const \[position, item\] of source\.entries\(\)\)/);
  assert.match(service,/before\.completedAt \?\? new Date\(\)/);
});

test("moved task is inserted at requested target position before renumbering",()=>{
  assert.match(service,/target\.splice\(requested,\s*0,\s*\{ id \}\)/);
  assert.match(service,/for \(const \[position, item\] of target\.entries\(\)\) if \(item\.id !== id\)/);
});

test("task sources and images are validated by stored state and bytes",()=>{
  assert.match(service,/conversation:\s*\{ archivedAt:\s*null \}/);
  assert.match(service,/sharp\(source\)\.metadata\(\)/);
  assert.match(service,/\["jpeg",\s*"png",\s*"webp"\]/);
  assert.match(service,/actualExtension !== sourceExt/);
});

test("archive keeps positions dense and done-column changes synchronize tasks",()=>{
  assert.match(service,/archive\(id:[\s\S]*pg_advisory_xact_lock/);
  assert.match(service,/const remaining = await tx\.workTask\.findMany/);
  assert.match(service,/for \(const \[position, item\] of remaining\.entries\(\)\)/);
  assert.match(service,/dto\.isDone !== before\.isDone/);
  assert.match(service,/tx\.workTask\.updateMany/);
});

test("board can explicitly return archived tasks without mixing them into active view",()=>{
  assert.match(controller,/@Query\("archived"\) archived\?: string/);
  assert.match(service,/async board\(archived = false\)/);
  assert.match(service,/archivedAt: archived \? \{ not: null \} : null/);
  assert.match(service,/archived\s*\? \{ tasks: \{ some: \{ archivedAt: \{ not: null \} \} \} \}\s*: \{ archivedAt: null \}/);
});
