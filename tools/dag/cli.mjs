#!/usr/bin/env node
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import {
  calculateReadyNodes, cleanupWorktree, executeNode, loadDag, refreshDependencies,
  renderGraph, retryNode, runDag, saveDag, showStatus, slug, validateDag
} from './orchestrator.mjs';
import { buildContextBundle, buildRepositoryMap, renderRepositoryMap } from './context.mjs';

function nodeTemplate(id, title, description, agent, kind, dependencies, paths, priority = 50) {
  const contextStrategies = ['ARCHITECT', 'PLANNER'].includes(agent) ? ['repository_map', 'targeted_search']
    : ['FRONTEND', 'BACKEND', 'DATABASE'].includes(agent) ? ['serena_symbols', 'serena_references', 'targeted_search']
      : ['repository', 'targeted_search'];
  return { id, title, description, agent, kind, depends_on: dependencies, status: 'PENDING', priority,
    affected_paths: paths, acceptance_criteria: ['Meet the node objective', 'Preserve existing behavior', 'Provide verification evidence'],
    validation_commands: [], required: true, human_approval: false, context_strategy: contextStrategies,
    review_verdict_required: ['test', 'review'].includes(kind) };
}

function needsApproval(text) {
  return /(auth|authentication|authorization|payment|credential|secret|production|infrastructure|destructive|delete|drop|migration|public api|плат[её]ж|авторизац|парол|секрет|продакш|удален|миграц)/i.test(text);
}

export function scaffold(title) {
  const id = `${slug(title)}-${Date.now().toString(36)}`;
  const nodes = [
    nodeTemplate('analyze', 'Analyze current architecture', title, 'ARCHITECT', 'analysis', [], [], 100),
    nodeTemplate('plan', 'Create implementation plan', title, 'PLANNER', 'analysis', ['analyze'], [], 90),
    nodeTemplate('frontend', 'Frontend implementation', title, 'FRONTEND', 'implementation', ['plan'], ['apps/web'], 70),
    nodeTemplate('backend', 'Backend implementation', title, 'BACKEND', 'implementation', ['plan'], ['apps/api'], 70),
    nodeTemplate('database', 'Database implementation', title, 'DATABASE', 'implementation', ['plan'], ['packages/database'], 70),
    nodeTemplate('integrate', 'Integrate implementation commits', title, 'INTEGRATOR', 'integration', ['frontend', 'backend', 'database'], [], 50),
    nodeTemplate('test', 'Verify acceptance criteria', title, 'TESTER', 'test', ['integrate'], [], 40),
    nodeTemplate('review', 'Review completed change', title, 'REVIEWER', 'review', ['test'], [], 30)
  ];
  if (needsApproval(title)) for (const node of nodes.filter((item) => ['implementation', 'integration'].includes(item.kind))) node.human_approval = true;
  return { version: 1, task: { id, title, description: title, base_ref: 'HEAD', max_fix_cycles: 3, fix_cycles: 0, created_at: new Date().toISOString() }, nodes };
}

function usage() {
  return `DAG Lite\n\nCommands:\n  plan <task>       create deterministic development DAG\n  demo              install safe Orders analysis demo\n  smoke             install context-routing smoke DAG\n  validate          validate schema and cycles\n  status            show node states\n  context [node]    show routed context metrics without the prompt\n  repo-map          show cached lightweight map; --refresh rebuilds it\n  run [node]        execute all ready work or one ready node\n  retry <node>      retry failure; --force-running recovers interruption\n  approve <node>    approve a human-gated node\n  cancel <node>     cancel a non-terminal node\n  graph [--mermaid] render dependencies\n  cleanup [node|--all] [--force] remove clean worktrees`;
}

export async function runCli(argv = process.argv.slice(2), dependencies = {}) {
  const repoRoot = dependencies.repoRoot ?? process.cwd();
  const currentFile = path.resolve(dependencies.stateFile ?? process.env.DAG_STATE_FILE ?? path.join(repoRoot, '.codex', 'dags', 'current.json'));
  const execute = dependencies.executeNode ?? executeNode;
  const runAll = dependencies.runDag ?? runDag;
  const cleanup = dependencies.cleanupWorktree ?? cleanupWorktree;
  const command = argv[0] ?? 'status';
  const args = argv.slice(1);
  if (['help', '--help', '-h'].includes(command)) { console.log(usage()); return; }
  if (command === 'plan') {
    const title = args.join(' ').trim(); if (!title) throw new Error('plan requires a task description');
    const dag = scaffold(title); await saveDag(currentFile, dag); console.log(showStatus(dag)); return;
  }
  if (command === 'demo') {
    const source = path.join(repoRoot, 'tools', 'dag', 'templates', 'orders-analysis.json');
    await mkdir(path.dirname(currentFile), { recursive: true }); await copyFile(source, currentFile);
    const dag = await loadDag(currentFile); refreshDependencies(dag); await saveDag(currentFile, dag); console.log(showStatus(dag)); return;
  }
  if (command === 'smoke') {
    const source = path.join(repoRoot, 'tools', 'dag', 'templates', 'context-smoke.json');
    await mkdir(path.dirname(currentFile), { recursive: true }); await copyFile(source, currentFile);
    const dag = await loadDag(currentFile); refreshDependencies(dag); await saveDag(currentFile, dag); console.log(showStatus(dag)); return;
  }
  if (command === 'repo-map') {
    const map = await buildRepositoryMap(repoRoot, { refresh: args.includes('--refresh') }); console.log(renderRepositoryMap(map)); return;
  }

  const dag = await loadDag(currentFile);
  if (command === 'validate') { validateDag(dag); console.log('DAG is valid'); return; }
  if (command === 'status') { console.log(showStatus(dag)); return; }
  if (command === 'graph') { console.log(renderGraph(dag, args.includes('--mermaid'))); return; }
  if (command === 'context') {
    const node = dag.nodes.find((item) => item.id === args[0]) ?? calculateReadyNodes(dag)[0];
    if (!node) throw new Error('No node available for context inspection');
    const bundle = await buildContextBundle(dag, node, repoRoot); console.log(JSON.stringify({ node: node.id, ...bundle.metrics }, null, 2)); return;
  }
  if (command === 'approve') {
    const node = dag.nodes.find((item) => item.id === args[0]); if (!node) throw new Error(`Unknown node: ${args[0]}`);
    if (!node.human_approval) throw new Error(`${node.id} does not require approval`);
    node.approved_at = new Date().toISOString(); refreshDependencies(dag); await saveDag(currentFile, dag); console.log(showStatus(dag)); return;
  }
  if (command === 'retry') { retryNode(dag, args[0], { forceRunning: args.includes('--force-running') }); await saveDag(currentFile, dag); console.log(showStatus(dag)); return; }
  if (command === 'cancel') {
    const node = dag.nodes.find((item) => item.id === args[0]); if (!node) throw new Error(`Unknown node: ${args[0]}`);
    if (['DONE', 'CANCELLED'].includes(node.status)) throw new Error(`${node.id} is already terminal`);
    node.status = 'CANCELLED'; node.completed_at = new Date().toISOString(); refreshDependencies(dag); await saveDag(currentFile, dag); console.log(showStatus(dag)); return;
  }
  if (command === 'cleanup') {
    const force = args.includes('--force'); const all = args.includes('--all'); const id = args.find((arg) => !arg.startsWith('--'));
    const nodes = all ? dag.nodes : dag.nodes.filter((node) => node.id === id);
    if (!all && !id) throw new Error('cleanup requires a node id or --all');
    if (!all && nodes.length === 0) throw new Error(`Unknown node: ${id}`);
    for (const node of nodes) await cleanup(dag, node, repoRoot, { force });
    await saveDag(currentFile, dag); console.log('Worktree cleanup complete'); return;
  }
  if (command === 'run') {
    const requested = args[0];
    if (requested) {
      const ready = calculateReadyNodes(dag); const node = ready.find((item) => item.id === requested);
      if (!node) throw new Error(`${requested} is not READY`);
      await execute(dag, node, { repoRoot, onState: async () => saveDag(currentFile, dag) }); refreshDependencies(dag); await saveDag(currentFile, dag); console.log(showStatus(dag));
      if (node.status !== 'DONE') process.exitCode = 1;
    } else {
      const result = await runAll(dag, { repoRoot, stateFile: currentFile, autoFix: true }); console.log(showStatus(result.dag));
      if (!result.complete) process.exitCode = 1;
    }
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${usage()}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
