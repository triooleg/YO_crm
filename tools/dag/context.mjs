import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_DIRS = new Set(['.git', '.next', '.turbo', '.worktrees', 'node_modules', 'dist', 'coverage', 'uploads', 'backups', 'output', 'tmp']);
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.prisma']);
const STRATEGIES = new Set(['repository', 'repository_map', 'targeted_search', 'serena_symbols', 'serena_references', 'repomix', 'context7']);
const COMPACT_GLOBAL_RULES = `AGENTS.md is authoritative; consult only relevant sections. Preserve existing behavior and unrelated changes. Never replace production logic/data with mocks. Inspect implementation, API, models, dependencies and regressions before editing. Do not expose secrets or customer/payment/private-message data. Use assigned paths only; never merge main, push or deploy.`;
export const DEFAULT_CONTEXT_BUDGET = Object.freeze({
  global_rules: 9000,
  role: 4000,
  task: 6000,
  dependencies: 9000,
  repository_map: 10000,
  total: 30000
});

export function envFlag(name, fallback = false, env = process.env) {
  const value = env[name];
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
}

function commandAvailable(command, env = process.env) {
  if (!command) return false;
  if (path.isAbsolute(command)) return existsSync(command);
  const directories = String(env.PATH ?? env.Path ?? '').split(path.delimiter).filter(Boolean);
  const extensions = process.platform === 'win32' ? String(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';') : [''];
  return directories.some((directory) => extensions.some((extension) => existsSync(path.join(directory, `${command}${extension}`)) || existsSync(path.join(directory, command))));
}

export function defaultContextStrategy(node) {
  if (node.context_strategy?.length) return [...node.context_strategy];
  if (['ARCHITECT', 'PLANNER'].includes(node.agent)) return ['repository_map', 'targeted_search'];
  if (['FRONTEND', 'BACKEND', 'DATABASE'].includes(node.agent)) return ['serena_symbols', 'serena_references', 'targeted_search'];
  if (node.agent === 'INTEGRATOR') return ['repository', 'targeted_search'];
  return ['repository', 'targeted_search'];
}

export function validateContextStrategy(strategy = []) {
  const invalid = strategy.filter((item) => !STRATEGIES.has(item));
  if (invalid.length) throw new Error(`unknown context strategy: ${invalid.join(', ')}`);
  return true;
}

function bounded(value, maximum) {
  const text = String(value ?? '');
  if (text.length <= maximum) return text;
  const half = Math.max(0, Math.floor((maximum - 32) / 2));
  return `${text.slice(0, half)}\n[...context truncated...]\n${text.slice(-half)}`;
}

async function readOptional(file) {
  try { return await readFile(file, 'utf8'); } catch { return ''; }
}

async function runLocalTool(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, windowsHide: true, shell: false });
    let stdout = ''; let stderr = ''; let settled = false;
    const timer = setTimeout(() => { if (!settled) child.kill(); }, options.timeoutMs ?? 30000);
    child.stdout.on('data', (chunk) => { if (stdout.length < 200_000) stdout += chunk; });
    child.stderr.on('data', (chunk) => { if (stderr.length < 20_000) stderr += chunk; });
    child.on('error', (error) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code: -1, stdout, stderr: error.message }); } });
    child.on('close', (code) => { if (!settled) { settled = true; clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); } });
  });
}

async function walk(root, relative = '', output = []) {
  const directory = path.join(root, relative);
  let entries = [];
  try { entries = await readdir(directory, { withFileTypes: true }); } catch { return output; }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.env') || EXCLUDED_DIRS.has(entry.name)) continue;
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) await walk(root, child, output);
    else if (CODE_EXTENSIONS.has(path.extname(entry.name)) || ['package.json', 'pnpm-workspace.yaml'].includes(entry.name)) output.push(child.replaceAll('\\', '/'));
  }
  return output;
}

async function repositoryFingerprint(repoRoot, files) {
  const hash = createHash('sha256');
  for (const file of files) {
    try {
      const details = await stat(path.join(repoRoot, file));
      hash.update(`${file}:${details.size}:`);
      if (details.size <= 256_000) hash.update(await readFile(path.join(repoRoot, file)));
      else hash.update(`large:${details.mtimeMs}`);
      hash.update('\n');
    } catch { hash.update(`${file}:missing\n`); }
  }
  return hash.digest('hex');
}

function symbolsFrom(source) {
  const symbols = [];
  const expression = /(?:export\s+)?(?:abstract\s+)?(?:class|interface|enum|type|function)\s+([A-Za-z_$][\w$]*)|(?:@Controller\([^)]*\)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*))|^\s*model\s+([A-Za-z_$][\w$]*)/gm;
  let match;
  while ((match = expression.exec(source)) && symbols.length < 24) symbols.push(match[1] ?? match[2] ?? match[3]);
  return [...new Set(symbols)];
}

export async function buildRepositoryMap(repoRoot, options = {}) {
  const files = await walk(repoRoot);
  const fingerprint = await repositoryFingerprint(repoRoot, files);
  const cacheFile = options.cacheFile ?? path.join(repoRoot, '.codex', 'cache', 'repo-map.json');
  if (!options.refresh && envFlag('CODEX_REPO_MAP_CACHE_ENABLED', true, options.env)) {
    try {
      const cached = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (cached.fingerprint === fingerprint) return { ...cached, cache_hit: true };
    } catch { /* cache is optional */ }
  }
  const important = files.filter((file) => /^(apps\/(api\/src|web\/(app|components|lib))|packages\/database\/prisma|package\.json|pnpm-workspace\.yaml)/.test(file));
  const entries = [];
  for (const file of important.slice(0, 260)) {
    let source = '';
    try {
      const details = await stat(path.join(repoRoot, file));
      if (details.size <= 256_000) source = await readFile(path.join(repoRoot, file), 'utf8');
    } catch { /* omit unreadable files */ }
    const symbols = symbolsFrom(source);
    if (symbols.length || /(?:package\.json|pnpm-workspace\.yaml|schema\.prisma)$/.test(file)) entries.push({ file, symbols });
  }
  const map = { version: 2, generated_at: new Date().toISOString(), fingerprint, files_scanned: important.length, entries, cache_hit: false };
  if (envFlag('CODEX_REPO_MAP_CACHE_ENABLED', true, options.env)) {
    try { await mkdir(path.dirname(cacheFile), { recursive: true }); await writeFile(cacheFile, `${JSON.stringify(map, null, 2)}\n`, 'utf8'); } catch { /* safe fallback: uncached map */ }
  }
  return map;
}

export function renderRepositoryMap(map, maximum = DEFAULT_CONTEXT_BUDGET.repository_map) {
  const lines = [`Repository map (${map.entries.length} entries; ${map.files_scanned} files scanned; cache ${map.cache_hit ? 'hit' : 'miss'}):`];
  for (const entry of map.entries) lines.push(`- ${entry.file}${entry.symbols.length ? `: ${entry.symbols.join(', ')}` : ''}`);
  return bounded(lines.join('\n'), maximum);
}

export async function buildRepomixOverview(repoRoot, node, options = {}) {
  const env = options.env ?? process.env;
  const include = (node.affected_paths ?? []).filter((item) => !item.includes('..')).join(',') || 'apps/**,packages/**,package.json,pnpm-workspace.yaml';
  const command = env.CODEX_REPOMIX_COMMAND ?? (process.platform === 'win32' ? 'npx.cmd' : 'npx');
  const args = command.toLowerCase().includes('npx')
    ? ['-y', 'repomix@1.18.0', '.', '--config', 'repomix.config.json', '--stdout', '--no-files', '--include', include]
    : ['.', '--config', 'repomix.config.json', '--stdout', '--no-files', '--include', include];
  const safeEnv = Object.fromEntries(['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].filter((name) => env[name] !== undefined).map((name) => [name, env[name]]));
  const runner = options.runner ?? runLocalTool;
  const result = await runner(command, args, { cwd: repoRoot, env: safeEnv, timeoutMs: Number(env.CODEX_REPOMIX_TIMEOUT_MS ?? 30000) });
  if (result.code !== 0 || !result.stdout.trim()) return { ok: false, reason: bounded(result.stderr || `Repomix exited ${result.code}`, 500), text: '' };
  return { ok: true, reason: null, text: bounded(result.stdout, options.maximum ?? DEFAULT_CONTEXT_BUDGET.repository_map) };
}

function extractStructuredHandoff(report) {
  const match = String(report ?? '').match(/HANDOFF_SUMMARY\s*:\s*```json\s*([\s\S]*?)```/i);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

export function compactDependencySummary(node, report = '', maximum = 1800) {
  const structured = extractStructuredHandoff(report);
  const validation = node.validation_result?.results?.map((item) => `${item.command}: ${item.exit_status === 0 ? 'PASS' : 'FAIL'}`).join('; ') || 'not recorded';
  const fallbackDecision = bounded(String(report).replace(/^# Failure\s*/i, '').trim(), 450) || 'No narrative report available.';
  const value = {
    node_id: node.id,
    result: node.status,
    files_changed: structured?.files_changed ?? node.affected_paths ?? [],
    public_interfaces_changed: structured?.public_interfaces_changed ?? 'not declared',
    database_changes: structured?.database_changes ?? 'not declared',
    important_decisions: structured?.important_decisions ?? fallbackDecision,
    risks: structured?.risks ?? (node.failure_reason ? [bounded(node.failure_reason, 500)] : []),
    tests: structured?.tests ?? validation,
    branch: node.branch ?? null,
    commit: node.commit ?? null
  };
  return bounded(JSON.stringify(value, null, 2), maximum);
}

export function resolveContextTools(node, env = process.env) {
  const requested = defaultContextStrategy(node); validateContextStrategy(requested);
  const serenaCommand = env.CODEX_SERENA_COMMAND ?? 'serena';
  const enabled = {
    optimization: envFlag('CODEX_CONTEXT_OPTIMIZATION_ENABLED', true, env),
    serena: envFlag('CODEX_SERENA_ENABLED', false, env) && (envFlag('CODEX_SERENA_ASSUME_AVAILABLE', false, env) || commandAvailable(serenaCommand, env)),
    repomix: envFlag('CODEX_REPOMIX_ENABLED', false, env),
    context7: envFlag('CODEX_CONTEXT7_ENABLED', false, env),
    budget: envFlag('CODEX_CONTEXT_BUDGET_ENABLED', true, env),
    repo_map: envFlag('CODEX_REPO_MAP_ENABLED', true, env),
    minimal_tool_surface: envFlag('CODEX_MINIMAL_TOOL_SURFACE_ENABLED', false, env)
  };
  const used = []; const fallbacks = [];
  for (const strategy of requested) {
    const tool = strategy.startsWith('serena_') ? 'serena' : strategy;
    if (tool === 'serena' && !enabled.serena) { fallbacks.push(`${strategy}->targeted_search (Serena disabled or unavailable)`); if (!used.includes('targeted_search')) used.push('targeted_search'); continue; }
    if (tool === 'repomix' && !enabled.repomix) { fallbacks.push('repomix->repository_map'); if (!used.includes('repository_map')) used.push('repository_map'); continue; }
    if (tool === 'context7' && !enabled.context7) { fallbacks.push('context7->repository'); if (!used.includes('repository')) used.push('repository'); continue; }
    if (tool === 'repository_map' && !enabled.repo_map) { fallbacks.push('repository_map->targeted_search'); if (!used.includes('targeted_search')) used.push('targeted_search'); continue; }
    if (!used.includes(strategy)) used.push(strategy);
  }
  return { requested, used, fallbacks, enabled };
}

export function codexToolConfigArgs(node, env = process.env) {
  const tools = resolveContextTools(node, env); const args = [];
  if (!tools.enabled.optimization) return args;
  // Do not use --ignore-user-config: it also drops local sandbox/approval
  // policy. Current Codex has only two built-in MCP servers; optional external
  // servers below remain lazy and are added only for selected nodes.
  if (tools.used.some((item) => item.startsWith('serena_'))) {
    const command = env.CODEX_SERENA_COMMAND ?? 'serena';
    args.push('-c', `mcp_servers.serena.command=${JSON.stringify(command)}`);
    args.push('-c', 'mcp_servers.serena.args=["start-mcp-server","--project-from-cwd","--context=codex"]');
  }
  if (tools.used.includes('context7')) args.push('-c', 'mcp_servers.context7.url="https://mcp.context7.com/mcp"');
  return args;
}

export function extractCodexTelemetry(jsonLines) {
  let toolCalls = 0; let filesRead = 0; let largeFilesRead = 0;
  for (const line of String(jsonLines ?? '').split(/\r?\n/)) {
    try {
      const event = JSON.parse(line); const item = event?.item;
      if (!item || event.type !== 'item.completed') continue;
      if (['command_execution', 'mcp_tool_call', 'file_search', 'web_search'].includes(item.type)) toolCalls += 1;
      const command = String(item.command ?? item.name ?? '');
      if (/\b(?:rg|Get-Content|read_file|find_symbol|find_referencing_symbols)\b/i.test(command)) filesRead += 1;
      if (/Get-Content.+(?:-Raw|Select-Object\s+-First\s+(?:[5-9]\d\d|\d{4,}))/i.test(command)) largeFilesRead += 1;
    } catch { /* diagnostics are not telemetry events */ }
  }
  return { tool_calls: toolCalls, files_read: filesRead, large_files_read: largeFilesRead };
}

async function buildLegacyContextBundle(dag, node, repoRoot) {
  const roleName = `${node.agent.toLowerCase()}.md`;
  const role = (await readOptional(path.join(repoRoot, '.codex', 'agents', roleName))) || (await readOptional(path.join(repoRoot, '.agents', roleName))) || `# ${node.agent}`;
  const dependencies = [];
  for (const id of node.depends_on ?? []) {
    const dependency = dag.nodes.find((item) => item.id === id);
    if (dependency) dependencies.push(`## ${id} metadata\nstatus: ${dependency.status}\nbranch: ${dependency.branch ?? '(none)'}\ncommit: ${dependency.commit ?? '(none)'}`);
    if (dependency?.result_file) dependencies.push(`## ${id} report\n${bounded(await readOptional(dependency.result_file), 4000)}`);
  }
  const prompt = [
    role, '# DAG node', `Task: ${dag.task.title}`, `Task context: ${dag.task.description}`, `Node: ${node.title}`, node.description,
    `Affected paths: ${(node.affected_paths ?? []).join(', ') || '(read-only repository-wide inspection)'}`,
    'Read AGENTS.md, CHAT_HANDOFF.md, PROJECT_BLUEPRINT.md, ROADMAP.md and docs/dag-architecture-report.md.',
    `Dependency evidence:\n${dependencies.join('\n') || '(none)'}`
  ].join('\n\n');
  return { prompt, tools: { requested: ['legacy'], used: ['legacy'], fallbacks: [], enabled: { optimization: false } }, metrics: {
    context_chars: prompt.length, context_bytes: Buffer.byteLength(prompt), approximate_input_tokens: Math.ceil(prompt.length / 4), context_files: 1,
    strategy_requested: ['legacy'], strategy_used: ['legacy'], fallbacks: [], budget_enabled: false, sections_chars: { legacy: prompt.length }
  } };
}

export async function buildContextBundle(dag, node, repoRoot, options = {}) {
  const env = options.env ?? process.env;
  if (!envFlag('CODEX_CONTEXT_OPTIMIZATION_ENABLED', true, env)) return buildLegacyContextBundle(dag, node, repoRoot);
  const tools = resolveContextTools(node, env);
  const budget = { ...DEFAULT_CONTEXT_BUDGET, ...(dag.task.context_budget ?? {}), ...(node.context_budget ?? {}) };
  const globalRules = COMPACT_GLOBAL_RULES;
  const roleName = `${node.agent.toLowerCase()}.md`;
  const role = (await readOptional(path.join(repoRoot, '.codex', 'agents', roleName))) || (await readOptional(path.join(repoRoot, '.agents', roleName))) || `# ${node.agent}`;
  const dependencies = [];
  for (const id of node.depends_on ?? []) {
    const dependency = dag.nodes.find((item) => item.id === id); if (!dependency) continue;
    const report = dependency.result_file ? await readOptional(dependency.result_file) : '';
    dependencies.push(compactDependencySummary(dependency, report));
  }
  let repoMap = '';
  if (tools.used.includes('repomix')) {
    const repomix = await buildRepomixOverview(repoRoot, node, { env, runner: options.repomixRunner, maximum: budget.repository_map });
    if (repomix.ok) repoMap = `Repomix architecture overview:\n${repomix.text}`;
    else {
      tools.used = tools.used.filter((item) => item !== 'repomix'); if (!tools.used.includes('repository_map')) tools.used.push('repository_map');
      tools.fallbacks.push(`repomix->repository_map (${repomix.reason})`);
    }
  }
  if (!repoMap && tools.used.includes('repository_map')) repoMap = renderRepositoryMap(await buildRepositoryMap(repoRoot, { env }), budget.repository_map);
  const task = [
    `Task: ${dag.task.title}`, `Task context: ${dag.task.description}`, `Local-only: ${dag.task.local_only === true ? 'yes' : 'no'}`,
    `Node: ${node.title}`, node.description, `Kind: ${node.kind}`,
    `Affected paths: ${(node.affected_paths ?? []).join(', ') || '(read-only scoped inspection)'}`,
    `Acceptance criteria:\n${(node.acceptance_criteria ?? []).map((item) => `- ${item}`).join('\n')}`,
    `Validation commands:\n${(node.validation_commands ?? []).map((item) => `- ${item}`).join('\n') || '- none'}`
  ].join('\n\n');
  const sections = {
    global_rules: bounded(globalRules, budget.global_rules), role: bounded(role, budget.role), task: bounded(task, budget.task),
    dependencies: bounded(dependencies.join('\n\n'), budget.dependencies), repository_map: bounded(repoMap, budget.repository_map)
  };
  const retrieval = [
    `Context: ${tools.used.join(', ')}${tools.fallbacks.length ? `; fallback ${tools.fallbacks.join(', ')}` : ''}.`,
    'Search order: symbol, references, exact file, scoped search, repo map, broad search. Outline large files before reading fragments.',
    tools.used.some((item) => item.startsWith('serena_')) ? 'Serena is navigation-only; keep DAG scope.' : '',
    tools.used.includes('context7') ? 'Context7 is only for version-specific external docs after repository/version checks.' : '',
    tools.used.includes('repomix') ? 'Repomix is architecture-only; never paste a full pack.' : ''
  ].filter(Boolean).join('\n');
  const execution = ['Preserve unrelated dirty changes. Never deploy, push, or merge to main.', node.kind === 'implementation' || node.kind === 'integration' || node.kind === 'fix'
    ? 'Commit only assigned changes with explicit paths; do not use git add .'
    : 'This node is read-only: do not modify files. Leave declared validation commands to the orchestrator.'].join('\n');
  const verdict = node.review_verdict_required ? 'Your final response must begin with exactly PASS, FAIL, or BLOCK; non-PASS must list actionable findings.' : '';
  const handoff = 'End with compact HANDOFF_SUMMARY fenced JSON: node_id, result, files_changed, public_interfaces_changed, database_changes, important_decisions, risks, tests, commit. No secrets.';
  let prompt = [`# Global rules\n${sections.global_rules}`, `# Role\n${sections.role}`, `# DAG node\n${sections.task}`, `# Context routing\n${retrieval}`, sections.repository_map ? `# Repository map\n${sections.repository_map}` : '', `# Dependency summaries\n${sections.dependencies || '(none)'}`, execution, verdict, handoff].filter(Boolean).join('\n\n');
  if (tools.enabled.budget) prompt = bounded(prompt, budget.total);
  const metrics = {
    context_chars: prompt.length, context_bytes: Buffer.byteLength(prompt), approximate_input_tokens: Math.ceil(prompt.length / 4),
    context_files: [role && `.codex/agents/${roleName}`, repoMap && '.codex/cache/repo-map.json'].filter(Boolean).length,
    strategy_requested: tools.requested, strategy_used: tools.used, fallbacks: tools.fallbacks, budget_enabled: tools.enabled.budget,
    sections_chars: Object.fromEntries(Object.entries(sections).map(([name, value]) => [name, value.length]))
  };
  return { prompt, metrics, tools };
}
