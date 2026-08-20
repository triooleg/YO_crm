import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
const ui=await readFile(new URL("../components/tasks-workspace.tsx",import.meta.url),"utf8").catch(()=>"");
const css=await readFile(new URL("../app/tasks-workspace.css",import.meta.url),"utf8").catch(()=>"");
const i18n=await readFile(new URL("../lib/i18n.ts",import.meta.url),"utf8");

test("tasks navigation renders the real kanban workspace",()=>{
  assert.match(shell,/TasksWorkspace/);
  assert.match(shell,/<TasksWorkspace\/>/);
  assert.doesNotMatch(shell,/section===items\[7\]\[0\][^?]*\?<ComingSoon/);
});

test("approved compact view is default and visual view remains switchable",()=>{
  assert.match(ui,/useState<"compact"\s*\|\s*"visual">\("compact"\)/);
  assert.match(ui,/tasksUi\.compactView/);
  assert.match(ui,/tasksUi\.visualView/);
  assert.match(css,/\.tasks-board\.visual/);
  assert.match(css,/\.task-card-thumb/);
});

test("kanban supports incoming messages, admin tasks, assignees, photos and deadlines",()=>{
  assert.match(ui,/\/tasks\/incoming/);
  assert.match(ui,/tasksUi\.fromInbox/);
  assert.match(ui,/tasksUi\.forAdministrator/);
  assert.match(ui,/assigneeId/);
  assert.match(ui,/attachmentPaths/);
  assert.match(ui,/dueAt/);
  assert.match(ui,/markerColor/);
});

test("new visible task copy is centralized",()=>{
  assert.match(i18n,/export const tasksUi/);
  assert.doesNotMatch(ui,/>\s*(Новая задача|Из входящего|Для администратора|Закупки)\s*</);
});

test("mobile board scrolls internally without document overflow",()=>{
  assert.match(css,/@media\(max-width:650px\)/);
  assert.match(css,/\.tasks-board-wrap\{[^}]*overflow-x:auto/);
  assert.match(css,/\.tasks-column\{[^}]*min-width:/);
  assert.match(css,/\.tasks-header-actions \.phase2-primary\{[^}]*background:#7047eb[^}]*color:#fff/);
  assert.match(css,/\.tasks-modal>header\{[^}]*flex-direction:row/);
});
