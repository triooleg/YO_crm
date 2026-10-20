#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { buildContextBundle } from './context.mjs';
import { loadDag } from './orchestrator.mjs';

const repoRoot = process.cwd();
const stateFile = path.resolve(process.env.DAG_STATE_FILE ?? path.join(repoRoot, '.codex', 'dags', 'current.json'));
const baseline = JSON.parse(await readFile(path.join(repoRoot, 'tools', 'dag', 'baseline.json'), 'utf8'));
const dag = await loadDag(stateFile);

async function measure(env) {
  const started = performance.now(); const rows = [];
  for (const node of dag.nodes) {
    const bundle = await buildContextBundle(dag, node, repoRoot, { env });
    rows.push({ node: node.id, chars: bundle.metrics.context_chars, approximate_tokens: bundle.metrics.approximate_input_tokens, context_files: bundle.metrics.context_files, strategy: bundle.metrics.strategy_used });
  }
  return {
    task: dag.task.id,
    context_generation_ms: Number((performance.now() - started).toFixed(1)),
    average_context_chars: Math.round(rows.reduce((sum, row) => sum + row.chars, 0) / rows.length),
    average_approximate_tokens: Math.round(rows.reduce((sum, row) => sum + row.approximate_tokens, 0) / rows.length),
    rows
  };
}

const before = await measure({ CODEX_CONTEXT_OPTIMIZATION_ENABLED: 'false' });
const after = await measure({ CODEX_CONTEXT_OPTIMIZATION_ENABLED: 'true', CODEX_CONTEXT_BUDGET_ENABLED: 'true', CODEX_REPO_MAP_ENABLED: 'true', CODEX_REPO_MAP_CACHE_ENABLED: 'true' });
const percent = before.average_context_chars ? Number((((after.average_context_chars - before.average_context_chars) / before.average_context_chars) * 100).toFixed(1)) : null;
console.log(JSON.stringify({
  measured_at: new Date().toISOString(), exact_provider_tokens_available: false,
  process_baseline: baseline,
  same_task_comparison: { before, after, delta: { average_context_chars: after.average_context_chars - before.average_context_chars, average_context_percent: percent, context_generation_ms: Number((after.context_generation_ms - before.context_generation_ms).toFixed(1)) } }
}, null, 2));
