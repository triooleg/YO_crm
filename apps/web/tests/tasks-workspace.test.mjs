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
  assert.match(css,/@media\(max-width:650px\)\{[\s\S]*?\.tasks-modal\{width:100%;max-width:720px/);
});

test("drop position is calculated without the dragged card and an empty column appends",()=>{
  assert.match(ui,/const targetIndex = column\.tasks[\s\S]*filter\(\(item\) => item\.id !== dragged\.current\)[\s\S]*findIndex\(\(item\) => item\.id === task\.id\)/);
  assert.match(ui,/const insertAfter =[\s\S]*event\.clientY > bounds\.top \+ bounds\.height \/ 2/);
  assert.match(ui,/move\(\s*dragged\.current,\s*column\.id,\s*targetPosition,?\s*\)/);
  assert.match(ui,/async function move\(taskId: string, columnId: string, position\?: number\)/);
  assert.match(ui,/dragged\.current !== task\.id/);
});

test("archived task mode is explicit and archived cards cannot be dragged",()=>{
  assert.match(ui,/showArchived/);
  assert.match(ui,/`\/tasks\/board\?archived=\$\{archived\}`/);
  assert.match(ui,/draggable=\{!showArchived\}/);
  assert.match(ui,/setArchivedTask\(task\)/);
  assert.match(ui,/tasks-archived-detail/);
  assert.match(ui,/tasksUi\.archivedTasks/);
  assert.match(i18n,/archivedTasks:\s*"Архивные"/);
});
