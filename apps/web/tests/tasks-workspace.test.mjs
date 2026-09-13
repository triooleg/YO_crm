import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const shell=await readFile(new URL("../components/crm-shell.tsx",import.meta.url),"utf8");
const ui=await readFile(new URL("../components/tasks-workspace.tsx",import.meta.url),"utf8").catch(()=>"");
const css=await readFile(new URL("../app/tasks-workspace.css",import.meta.url),"utf8").catch(()=>"");
const i18n=await readFile(new URL("../lib/i18n.ts",import.meta.url),"utf8");
const channelSource=await readFile(new URL("../lib/task-channel.ts",import.meta.url),"utf8").catch(()=>"");
const channelCompiled=ts.transpileModule(channelSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const channelModule={exports:{}};
new Function("exports","module",channelCompiled)(channelModule.exports,channelModule);
const {taskChannel}=channelModule.exports;

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
  assert.match(css,/@media\(max-width:650px\)\{[\s\S]*?\.mantine-Modal-content\.tasks-modal\{box-sizing:border-box;width:calc\(100vw - 32px\);max-width:calc\(100vw - 32px\);min-width:0;padding:0/);
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

test("клиентская задача показывает имя клиента и значок его канала",()=>{
  assert.match(ui,/taskChannel\(task\)/);
  assert.match(ui,/className=\{`task-client-channel source-\$\{channel\.toLowerCase\(\)\}`\}/);
  assert.match(ui,/task\.client\.displayName/);
  assert.match(ui,/channel\s*&&/);
  assert.match(css,/\.task-client\{/);
  assert.match(css,/\.task-client-channel\.source-facebook/);
  assert.match(i18n,/clientChannel:/);
  assert.match(i18n,/sources:\s*\{[\s\S]*FACEBOOK:\s*"Facebook"/);
  assert.match(ui,/function taskAccessibleLabel/);
  assert.match(ui,/task\.client\.displayName/);
  assert.match(ui,/tasksUi\.sources\[channel\]/);
  assert.match(ui,/aria-label=\{taskAccessibleLabel\(task\)\}/);
});

test("значок задачи fail-closed и не придумывает канал клиента",()=>{
  assert.equal(taskChannel({client:{id:"client-1",displayName:"Без канала"}}),undefined);
  assert.equal(taskChannel({client:{id:"client-1",displayName:"Meta",source:"FACEBOOK"}}),"FACEBOOK");
  assert.equal(taskChannel({client:{id:"client-1",displayName:"Meta",source:"FACEBOOK"},sourceMessage:{conversation:{channel:"INSTAGRAM"}}}),"INSTAGRAM");
  assert.equal(taskChannel({sourceMessage:{conversation:{channel:"FACEBOOK"}}}),"FACEBOOK");
  assert.equal(taskChannel({client:{id:"client-1",displayName:"Unknown",source:"OTHER"}}),undefined);
  assert.equal(taskChannel({client:{id:"client-1",displayName:"Prototype",source:"toString"}}),undefined);
  assert.match(ui,/if \(!task\.client\) return null/);
});

test("окно задачи показывает превью сохранённых и новых фотографий",()=>{
  assert.match(ui,/const previewPaths=\[/);
  assert.match(ui,/task\.attachments\?\.map\(\(attachment\)\s*=>\s*attachment\.path\)/);
  assert.match(ui,/className="task-form-previews"/);
  assert.match(ui,/previewPaths\.map\(\(path\)\s*=>/);
  assert.match(ui,/src=\{`\/api\/tasks\/images\/\$\{path\}`\}/);
  assert.match(css,/\.task-form-previews\{/);
  assert.match(css,/\.task-form-previews img\{/);
  assert.match(i18n,/photoPreviews:/);
});
