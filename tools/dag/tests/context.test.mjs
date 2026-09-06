import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildContextBundle, buildRepomixOverview, buildRepositoryMap, codexToolConfigArgs, compactDependencySummary,
  extractCodexTelemetry, resolveContextTools, validateContextStrategy
} from '../context.mjs';

function sampleNode(extra = {}) {
  return { id: 'backend', title: 'Backend', description: 'Inspect backend', agent: 'BACKEND', kind: 'analysis', depends_on: [], status: 'READY', priority: 1,
    affected_paths: ['apps/api/src/orders'], acceptance_criteria: ['Report'], validation_commands: [], required: true, human_approval: false, ...extra };
}

test('context strategies reject unknown tools and fall back safely', () => {
  assert.throws(() => validateContextStrategy(['everything']), /unknown context strategy/);
  const tools = resolveContextTools(sampleNode({ context_strategy: ['serena_symbols', 'repomix', 'context7'] }), {});
  assert.deepEqual(tools.used, ['targeted_search', 'repository_map', 'repository']);
  assert.equal(tools.fallbacks.length, 3);
});

test('MCP tools are lazy and minimal user configuration is isolated', () => {
  const node = sampleNode({ context_strategy: ['serena_symbols', 'context7'] });
  assert.deepEqual(codexToolConfigArgs(node, {}), []);
  const args = codexToolConfigArgs(node, { CODEX_SERENA_ENABLED: 'true', CODEX_SERENA_ASSUME_AVAILABLE: 'true', CODEX_CONTEXT7_ENABLED: 'true', CODEX_SERENA_COMMAND: 'serena-local' });
  assert.match(args.join(' '), /serena-local/); assert.match(args.join(' '), /mcp\.context7\.com/);
});

test('structured dependency handoff replaces a full transcript', () => {
  const report = 'Long narrative\nHANDOFF_SUMMARY:\n```json\n{"files_changed":["a.ts"],"public_interfaces_changed":"none","database_changes":"none","important_decisions":["keep API"],"risks":[],"tests":["PASS"],"commit":"abc"}\n```';
  const summary = compactDependencySummary(sampleNode({ status: 'DONE', commit: 'abc' }), report);
  assert.match(summary, /a\.ts/); assert.match(summary, /keep API/); assert.doesNotMatch(summary, /Long narrative/);
});

test('repository map is lightweight and cache invalidates on structural change', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-map-'));
  await mkdir(path.join(root, 'apps/api/src/orders'), { recursive: true });
  await writeFile(path.join(root, 'apps/api/src/orders/orders.service.ts'), 'export class OrdersService {}\n', 'utf8');
  const cacheFile = path.join(root, 'cache.json');
  const first = await buildRepositoryMap(root, { cacheFile, env: { CODEX_REPO_MAP_CACHE_ENABLED: 'true' } });
  const second = await buildRepositoryMap(root, { cacheFile, env: { CODEX_REPO_MAP_CACHE_ENABLED: 'true' } });
  assert.equal(first.cache_hit, false); assert.equal(second.cache_hit, true); assert.match(JSON.stringify(second), /OrdersService/);
  await writeFile(path.join(root, 'apps/api/src/orders/orders.service.ts'), 'export class ChangedOrdersService {}\n', 'utf8');
  const third = await buildRepositoryMap(root, { cacheFile, env: { CODEX_REPO_MAP_CACHE_ENABLED: 'true' } });
  assert.equal(third.cache_hit, false); assert.match(JSON.stringify(third), /ChangedOrdersService/);
});

test('repository map cache invalidates on a same-size edit with preserved mtime', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-map-same-size-'));
  const sourceFile = path.join(root, 'apps/api/src/orders/orders.service.ts');
  await mkdir(path.dirname(sourceFile), { recursive: true });
  await writeFile(sourceFile, 'export class OrdersService {}\n', 'utf8');
  const original = await stat(sourceFile);
  const cacheFile = path.join(root, 'cache.json');
  await buildRepositoryMap(root, { cacheFile, env: { CODEX_REPO_MAP_CACHE_ENABLED: 'true' } });
  await writeFile(sourceFile, 'export class OtherServiceX {}\n', 'utf8');
  await utimes(sourceFile, original.atime, original.mtime);
  const current = await stat(sourceFile);
  const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
  cached.fingerprint = createHash('sha256').update(`apps/api/src/orders/orders.service.ts:${current.size}:${current.mtimeMs}\n`).digest('hex');
  await writeFile(cacheFile, `${JSON.stringify(cached)}\n`, 'utf8');
  const rebuilt = await buildRepositoryMap(root, { cacheFile, env: { CODEX_REPO_MAP_CACHE_ENABLED: 'true' } });
  assert.equal(rebuilt.cache_hit, false);
  assert.match(JSON.stringify(rebuilt), /OtherServiceX/);
});

test('Repomix overview is scoped and failure remains a safe fallback', async () => {
  const node = sampleNode({ context_strategy: ['repomix'] });
  let observedArgs = [];
  const success = await buildRepomixOverview('D:\\repo', node, { env: { PATH: 'bin' }, runner: async (_command, args) => { observedArgs = args; return { code: 0, stdout: 'small map', stderr: '' }; } });
  assert.equal(success.ok, true); assert.match(observedArgs.join(' '), /apps\/api\/src\/orders/); assert.ok(observedArgs.includes('--no-files'));
  const failure = await buildRepomixOverview('D:\\repo', node, { env: {}, runner: async () => ({ code: 1, stdout: '', stderr: 'offline' }) });
  assert.equal(failure.ok, false); assert.match(failure.reason, /offline/);
});

test('context budget and dependency isolation are enforced', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-context-'));
  await mkdir(path.join(root, '.codex/agents'), { recursive: true });
  await writeFile(path.join(root, 'AGENTS.md'), 'G'.repeat(5000), 'utf8');
  await writeFile(path.join(root, '.codex/agents/backend.md'), 'Backend role', 'utf8');
  const frontendReport = path.join(root, 'frontend.md'); await writeFile(frontendReport, 'FRONTEND_PRIVATE_TRANSCRIPT', 'utf8');
  const planReport = path.join(root, 'plan.md'); await writeFile(planReport, 'Plan only', 'utf8');
  const backend = sampleNode({ depends_on: ['plan'], context_strategy: ['repository'], context_budget: { total: 1400, global_rules: 400 } });
  const dag = { task: { id: 'x', title: 'Task', description: 'Task', context_budget: {} }, nodes: [
    sampleNode({ id: 'frontend', agent: 'FRONTEND', status: 'DONE', result_file: frontendReport }),
    sampleNode({ id: 'plan', agent: 'PLANNER', status: 'DONE', result_file: planReport }), backend
  ] };
  const bundle = await buildContextBundle(dag, backend, root, { env: { CODEX_CONTEXT_BUDGET_ENABLED: 'true' } });
  assert.ok(bundle.prompt.length <= 1400); assert.doesNotMatch(bundle.prompt, /FRONTEND_PRIVATE_TRANSCRIPT/); assert.match(bundle.prompt, /Plan only/);
});

test('telemetry counts tool calls without retaining raw output', () => {
  const events = [
    { type: 'item.completed', item: { type: 'command_execution', command: 'rg -n Orders apps/api' } },
    { type: 'item.completed', item: { type: 'mcp_tool_call', name: 'find_symbol' } },
    { type: 'item.completed', item: { type: 'agent_message', text: 'done' } }
  ].map(JSON.stringify).join('\n');
  assert.deepEqual(extractCodexTelemetry(events), { tool_calls: 2, files_read: 2, large_files_read: 0 });
});
