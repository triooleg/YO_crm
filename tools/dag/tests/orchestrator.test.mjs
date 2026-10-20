import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  buildPrompt, calculateReadyNodes, cleanupWorktree, createFixTask, detectCycles, executeNode,
  extractLastAgentMessage, pathsOverlap, redactSecrets, refreshDependencies,
  retryNode, riskReasons, runDag, runProcess, safeEnvironment, saveDag, selectParallelWave,
  validateDag, worktreeIdentity
} from '../orchestrator.mjs';

function node(id, depends_on = [], extra = {}) {
  return { id, title: id, description: `do ${id}`, agent: 'TESTER', kind: 'analysis', depends_on,
    status: 'PENDING', priority: 1, affected_paths: [], acceptance_criteria: ['works'],
    validation_commands: [], required: true, human_approval: false, ...extra };
}

function dag(nodes) {
  return { version: 1, task: { id: 'unit', title: 'Unit DAG', description: 'test', base_ref: 'HEAD', max_fix_cycles: 3, fix_cycles: 0 }, nodes };
}

test('dependency resolution exposes only roots', () => {
  const value = dag([node('a'), node('b', ['a'])]);
  assert.deepEqual(calculateReadyNodes(value).map((item) => item.id), ['a']);
  assert.equal(value.nodes[1].status, 'BLOCKED');
  value.nodes[0].status = 'DONE';
  assert.deepEqual(calculateReadyNodes(value).map((item) => item.id), ['b']);
});

test('approval gate waits and opens after approval timestamp', () => {
  const value = dag([node('safe'), node('risky', ['safe'], { human_approval: true })]);
  value.nodes[0].status = 'DONE'; refreshDependencies(value);
  assert.equal(value.nodes[1].status, 'WAITING_APPROVAL');
  value.nodes[1].approved_at = new Date().toISOString(); refreshDependencies(value);
  assert.equal(value.nodes[1].status, 'READY');
});

test('cycle detection reports exact cycle path', () => {
  const value = dag([node('a', ['c']), node('b', ['a']), node('c', ['b'])]);
  assert.deepEqual(detectCycles(value), ['a', 'c', 'b', 'a']);
  assert.throws(() => validateDag(value), /a -> c -> b -> a/);
});

test('invalid DAG reports duplicate and missing dependencies', () => {
  const value = dag([node('a', ['missing']), node('a')]);
  assert.throws(() => validateDag(value), /duplicate node id/);
  assert.throws(() => validateDag(value), /missing dependency/);
});

test('context budgets require known positive finite numeric values', () => {
  const invalidNode = dag([node('a', [], { context_budget: { total: -1 } })]);
  assert.throws(() => validateDag(invalidNode), /context_budget\.total must be a positive finite number/);
  const invalidTask = dag([node('a')]);
  invalidTask.task.context_budget = { role: 'many' };
  assert.throws(() => validateDag(invalidTask), /task\.context_budget\.role must be a positive finite number/);
  const unknown = dag([node('a', [], { context_budget: { mystery: 20 } })]);
  assert.throws(() => validateDag(unknown), /unknown context_budget field mystery/);
});

test('max_parallel must be a positive integer', () => {
  const zero = dag([node('a')]); zero.task.max_parallel = 0;
  assert.throws(() => validateDag(zero), /task\.max_parallel must be a positive integer/);
  const fractional = dag([node('a')]); fractional.task.max_parallel = 1.5;
  assert.throws(() => validateDag(fractional), /task\.max_parallel must be a positive integer/);
});

test('role name validation prevents path traversal', () => {
  const value = dag([node('a', [], { agent: '../SECRETS' })]);
  assert.throws(() => validateDag(value), /uppercase role name/);
});

test('risky write nodes cannot bypass human approval in hand-edited JSON', () => {
  const value = dag([node('auth-change', [], { kind: 'implementation', description: 'change authentication', affected_paths: ['apps/api/src/auth'] })]);
  assert.throws(() => validateDag(value), /human_approval=true/);
  value.nodes[0].human_approval = true;
  assert.equal(validateDag(value), true);
});

test('dangerous validation commands require approval even on read-only node kinds', () => {
  const value = dag([node('unsafe-check', [], { validation_commands: ['Remove-Item production-data'] })]);
  assert.deepEqual(riskReasons(value, value.nodes[0]), ['dangerous validation command']);
  assert.throws(() => validateDag(value), /human_approval=true/);
  value.nodes[0].human_approval = true;
  assert.equal(validateDag(value), true);
});

test('child environment allowlist strips arbitrary secrets', () => {
  const env = safeEnvironment({ PATH: 'bin', CODEX_HOME: 'codex', DATABASE_URL: 'secret', OPENAI_API_KEY: 'secret' });
  assert.deepEqual(env, { PATH: 'bin', CODEX_HOME: 'codex' });
});

test('history redaction removes common secret forms', () => {
  const redacted = redactSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz password=hunter2 sk-abcdefghijklmnopqrstuvwxyz');
  assert.equal(redacted.includes('hunter2'), false); assert.equal(redacted.includes('sk-abc'), false); assert.match(redacted, /REDACTED/);
});

test('Codex JSONL parser extracts only the final agent message', () => {
  const output = '{"type":"item.completed","item":{"type":"agent_message","text":"first"}}\nnoise\n{"type":"item.completed","item":{"type":"agent_message","text":"PASS final"}}';
  assert.equal(extractLastAgentMessage(output), 'PASS final');
});

test('path conflicts include equal and nested paths', () => {
  assert.equal(pathsOverlap(['apps/web'], ['apps/web/components']), true);
  assert.equal(pathsOverlap(['apps/web'], ['apps/api']), false);
  const one = node('one', [], { kind: 'implementation', affected_paths: ['apps/web'] });
  const two = node('two', [], { kind: 'implementation', affected_paths: ['apps/web/app'] });
  const three = node('three', [], { kind: 'implementation', affected_paths: ['apps/api'] });
  assert.deepEqual(selectParallelWave([one, two, three]).selected.map((item) => item.id), ['one', 'three']);
  assert.deepEqual(selectParallelWave([one, three], 1).deferred.map((item) => item.id), ['three']);
});

test('successful read-only DAG reaches DONE and writes evidence', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-success-'));
  const value = dag([node('a'), node('b', ['a'])]);
  const result = await runDag(value, { repoRoot: root, invokeAgent: async ({ node: item }) => ({ code: 0, output: `done ${item.id}` }) });
  assert.equal(result.complete, true);
  assert.deepEqual(value.nodes.map((item) => item.status), ['DONE', 'DONE']);
  assert.match(await readFile(value.nodes[1].result_file, 'utf8'), /done b/);
});

test('failed node records reason and blocks dependants', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-fail-'));
  const value = dag([node('a'), node('b', ['a'])]);
  const result = await runDag(value, { repoRoot: root, invokeAgent: async () => ({ code: 9, stderr: 'boom' }) });
  assert.equal(result.complete, false);
  assert.equal(value.nodes[0].status, 'FAILED');
  assert.match(value.nodes[0].failure_reason, /boom/);
  assert.equal(value.nodes[0].failure_type, 'agent-execution');
  assert.equal(value.task.fix_cycles, 0);
  assert.equal(value.nodes[1].status, 'BLOCKED');
});

test('automatic fix is created only for a validation failure', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-autofix-'));
  const value = dag([node('a', [], { validation_commands: ['verify'] })]);
  let validations = 0;
  const runner = async (command) => command === 'verify' && validations++ === 0
    ? { code: 1, stdout: '', stderr: 'first failure' }
    : { code: 0, stdout: '', stderr: '' };
  const result = await runDag(value, { repoRoot: root, runner, autoFix: true,
    invokeAgent: async ({ node: item }) => ({ code: 0, output: `ok ${item.id}` }),
    createWorktree: async (_dag, item) => { item.base_commit = 'base'; return { branch: `dag/unit/${item.id}`, worktree: root }; } });
  assert.equal(result.complete, true);
  assert.equal(value.task.fix_cycles, 1);
  assert.equal(value.nodes.some((item) => item.kind === 'fix'), true);
});

test('retry resets a failed node and enforces attempt limit', () => {
  const value = dag([node('a', [], { status: 'FAILED', attempts: 1, failure_reason: 'x' })]);
  retryNode(value, 'a'); assert.equal(value.nodes[0].status, 'READY');
  value.nodes[0].status = 'FAILED'; value.nodes[0].attempts = 3;
  assert.throws(() => retryNode(value, 'a'), /retry limit/);
  assert.equal(value.task.human_intervention_required, true);
});

test('interrupted RUNNING state requires an explicit recovery flag', () => {
  const value = dag([node('a', [], { status: 'RUNNING', attempts: 1 })]);
  assert.throws(() => retryNode(value, 'a'), /not FAILED/);
  retryNode(value, 'a', { forceRunning: true });
  assert.equal(value.nodes[0].status, 'READY');
});

test('fix task rewires failure without creating a dependency cycle', () => {
  const value = dag([node('base', [], { status: 'DONE' }), node('broken', ['base'], { status: 'FAILED', kind: 'test', failure_reason: 'regression' }), node('after', ['broken'])]);
  const fix = createFixTask(value, 'broken');
  assert.equal(fix.agent, 'INTEGRATOR');
  assert.deepEqual(fix.depends_on, ['base']);
  assert.equal(value.nodes[1].depends_on.includes(fix.id), true);
  assert.equal(detectCycles(value), null);
  assert.equal(fix.status, 'READY');
});

test('automatic fix preserves the human gate when its failure context is risky', () => {
  const value = dag([node('broken', [], { status: 'FAILED', kind: 'review', failure_reason: 'production deployment concern' })]);
  const fix = createFixTask(value, 'broken');
  assert.equal(fix.human_approval, true);
  assert.equal(fix.status, 'WAITING_APPROVAL');
  assert.equal(validateDag(value), true);
});

test('fix cycle limit requests human intervention', () => {
  const value = dag([node('broken', [], { status: 'FAILED', failure_reason: 'x' })]);
  value.task.max_fix_cycles = 1; value.task.fix_cycles = 1;
  assert.equal(createFixTask(value, 'broken'), null);
  assert.equal(value.task.human_intervention_required, true);
});

test('worktree names are deterministic and sanitized', () => {
  const value = dag([node('Web UI!')]); value.task.id = 'Feature 42 / Orders';
  const identity = worktreeIdentity(value, value.nodes[0], 'D:\\repo');
  assert.equal(identity.branch, 'dag/feature-42-orders/web-ui');
  assert.match(identity.worktree.replaceAll('\\', '/'), /\.worktrees\/dag-feature-42-orders-web-ui$/);
});

test('cleanup refuses a hand-edited unrelated worktree path', async () => {
  const value = dag([node('a', [], { worktree: 'D:\\unrelated' })]);
  await assert.rejects(() => cleanupWorktree(value, value.nodes[0], 'D:\\repo'), /unexpected worktree path/);
});

test('atomic state save validates before writing', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-save-')); const file = path.join(root, 'state.json');
  const value = dag([node('a')]); await saveDag(file, value);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).task.id, 'unit');
});

test('concurrent state saves are serialized into valid JSON', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-concurrent-save-')); const file = path.join(root, 'state.json');
  const first = dag([node('a')]); const second = dag([node('b')]); second.task.title = 'Second';
  await Promise.all([saveDag(file, first), saveDag(file, second)]);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).task.title, 'Second');
});

test('process runner enforces an explicit timeout', async () => {
  const result = await runProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeoutMs: 50 });
  assert.equal(result.code, -2); assert.equal(result.timedOut, true);
});

test('executeNode fails validation commands', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-validation-'));
  const value = dag([node('a', [], { status: 'READY', validation_commands: ['false-command'] })]);
  const runner = async (command) => command === 'false-command' ? { code: 2, stdout: '', stderr: 'bad validation' } : { code: 0, stdout: '', stderr: '' };
  const result = await executeNode(value, value.nodes[0], { repoRoot: root, runner, invokeAgent: async () => ({ code: 0, output: 'agent ok' }) });
  assert.equal(result.ok, false); assert.equal(value.nodes[0].status, 'FAILED');
  assert.equal(value.nodes[0].validation_result.results[0].exit_status, 2);
});

test('required review BLOCK verdict fails the node', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-review-'));
  const value = dag([node('review', [], { status: 'READY', kind: 'review', review_verdict_required: true })]);
  const result = await executeNode(value, value.nodes[0], { repoRoot: root, invokeAgent: async () => ({ code: 0, output: 'BLOCK\nunsafe' }) });
  assert.equal(result.ok, false); assert.equal(value.nodes[0].failure_type, 'review-blocker');
});

test('required tester FAIL verdict fails the node', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-tester-fail-'));
  const value = dag([node('test', [], { status: 'READY', kind: 'test', review_verdict_required: true })]);
  const result = await executeNode(value, value.nodes[0], { repoRoot: root, invokeAgent: async () => ({ code: 0, output: 'FAIL\ncommand failed' }) });
  assert.equal(result.ok, false); assert.equal(value.nodes[0].failure_type, 'review-blocker');
});

test('review blocker creates a bounded fix and retest', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-review-fix-'));
  const value = dag([node('review', [], { kind: 'review', review_verdict_required: true })]);
  let reviews = 0;
  const runner = async (_command, args) => args[0] === 'rev-parse' ? { code: 0, stdout: 'fixed-commit\n', stderr: '' } : { code: 0, stdout: '', stderr: '' };
  const result = await runDag(value, { repoRoot: root, runner, autoFix: true,
    createWorktree: async (_dag, item) => { item.base_commit = 'base'; return { branch: `dag/unit/${item.id}`, worktree: root }; },
    invokeAgent: async ({ node: item }) => ({ code: 0, output: item.kind === 'review' && reviews++ === 0 ? 'BLOCK\nregression' : (item.kind === 'review' ? 'PASS\nfixed' : 'fix committed') }) });
  assert.equal(result.complete, true); assert.equal(value.task.fix_cycles, 1);
  assert.equal(value.nodes.filter((item) => item.kind === 'fix').length, 1);
});

test('write node cannot finish without a new commit', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-no-commit-'));
  const value = dag([node('write', [], { status: 'READY', kind: 'implementation' })]);
  const runner = async (_command, args) => args[0] === 'rev-parse' ? { code: 0, stdout: 'same\n', stderr: '' } : { code: 0, stdout: '', stderr: '' };
  const result = await executeNode(value, value.nodes[0], { repoRoot: root, runner,
    createWorktree: async (_dag, item) => { item.base_commit = 'same'; return { branch: 'dag/unit/write', worktree: root }; },
    invokeAgent: async () => ({ code: 0, output: 'implemented' }) });
  assert.equal(result.ok, false); assert.equal(value.nodes[0].failure_type, 'task');
});

test('integrator prompt contains dependency branch and commit metadata', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-prompt-'));
  const value = dag([node('implementation', [], { status: 'DONE', branch: 'dag/unit/implementation', commit: 'abc123' }), node('integrate', ['implementation'], { agent: 'INTEGRATOR', kind: 'integration', human_approval: false })]);
  const prompt = await buildPrompt(value, value.nodes[1], root);
  assert.match(prompt, /"branch": "dag\/unit\/implementation"/); assert.match(prompt, /"commit": "abc123"/);
});
