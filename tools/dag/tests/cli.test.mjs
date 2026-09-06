import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runProcess, safeEnvironment } from '../orchestrator.mjs';
import { runCli } from '../cli.mjs';

const repoRoot = process.cwd();
const cli = path.join(repoRoot, 'tools', 'dag', 'cli.mjs');

async function invoke(stateFile, ...args) {
  return runProcess(process.execPath, [cli, ...args], { cwd: repoRoot, env: { ...safeEnvironment(), DAG_STATE_FILE: stateFile } });
}

test('CLI help, demo, status, validate, graph and cleanup work with isolated state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-cli-')); const state = path.join(root, 'current.json');
  assert.equal((await invoke(state, 'help')).code, 0);
  assert.equal((await invoke(state, 'demo')).code, 0);
  const status = await invoke(state, 'status'); assert.equal(status.code, 0); assert.match(status.stdout, /analyze-orders/);
  assert.equal((await invoke(state, 'validate')).code, 0);
  const graph = await invoke(state, 'graph', '--mermaid'); assert.equal(graph.code, 0); assert.match(graph.stdout, /flowchart TD/);
  assert.equal((await invoke(state, 'cleanup', 'analyze-orders')).code, 0);
});

test('CLI plan marks risky writes for approval', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-plan-')); const state = path.join(root, 'current.json');
  const result = await invoke(state, 'plan', 'Change authentication login flow'); assert.equal(result.code, 0, result.stderr);
  const planned = JSON.parse(await readFile(state, 'utf8'));
  assert.equal(planned.nodes.filter((node) => ['implementation', 'integration'].includes(node.kind)).every((node) => node.human_approval), true);
});

test('CLI approve, cancel and cleanup --all mutate only isolated state', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-cli-mutate-')); const state = path.join(root, 'current.json');
  await runCli(['plan', 'Change authentication login flow'], { repoRoot, stateFile: state });
  await runCli(['approve', 'frontend'], { repoRoot, stateFile: state });
  await runCli(['cancel', 'backend'], { repoRoot, stateFile: state });
  let cleaned = 0;
  await runCli(['cleanup', '--all'], { repoRoot, stateFile: state, cleanupWorktree: async () => { cleaned += 1; } });
  const value = JSON.parse(await readFile(state, 'utf8'));
  assert.ok(value.nodes.find((node) => node.id === 'frontend').approved_at);
  assert.equal(value.nodes.find((node) => node.id === 'backend').status, 'CANCELLED');
  assert.equal(cleaned, value.nodes.length);
});

test('CLI run supports one node and the full DAG through injected executors', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-cli-run-')); const state = path.join(root, 'current.json');
  await runCli(['demo'], { repoRoot, stateFile: state });
  await runCli(['run', 'analyze-orders'], { repoRoot, stateFile: state, executeNode: async (_dag, item) => { item.status = 'DONE'; return { ok: true, node: item }; } });
  assert.equal(JSON.parse(await readFile(state, 'utf8')).nodes[0].status, 'DONE');
  await runCli(['demo'], { repoRoot, stateFile: state });
  await runCli(['run'], { repoRoot, stateFile: state, runDag: async (value) => { for (const item of value.nodes) item.status = 'DONE'; return { dag: value, complete: true, events: [] }; } });
});

test('root pnpm DAG scripts invoke the public CLI', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dag-pnpm-')); const state = path.join(root, 'current.json');
  const env = { ...safeEnvironment(), DAG_STATE_FILE: state };
  const help = await runProcess('pnpm dag --help', [], { cwd: repoRoot, env, shell: true });
  assert.equal(help.code, 0, help.stderr); assert.match(help.stdout, /DAG Lite/);
  assert.equal((await invoke(state, 'demo')).code, 0);
  const status = await runProcess('pnpm dag:status', [], { cwd: repoRoot, env, shell: true });
  assert.equal(status.code, 0, status.stderr); assert.match(status.stdout, /analyze-orders/);
});
