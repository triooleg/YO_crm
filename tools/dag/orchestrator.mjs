import { spawn } from 'node:child_process';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildContextBundle, codexToolConfigArgs, extractCodexTelemetry, validateContextStrategy } from './context.mjs';

export const STATES = Object.freeze(['PENDING', 'BLOCKED', 'READY', 'WAITING_APPROVAL', 'RUNNING', 'DONE', 'FAILED', 'CANCELLED']);
export const KINDS = Object.freeze(['analysis', 'implementation', 'integration', 'test', 'review', 'fix']);
const TERMINAL = new Set(['DONE', 'FAILED', 'CANCELLED']);
const WRITE_KINDS = new Set(['implementation', 'integration', 'fix']);
const saveQueues = new Map();

export function now() { return new Date().toISOString(); }
export function redactSecrets(value) {
  return String(value ?? '')
    .replace(/-----BEGIN [^-]+ PRIVATE KEY-----[\s\S]*?-----END [^-]+ PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]{16,}/gi, 'Bearer [REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]{16,}\b/g, '[REDACTED API KEY]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED JWT]')
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|cookie)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}
export function safeEnvironment(source = process.env) {
  const names = ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'CODEX_HOME', 'TERM', 'LANG', 'LC_ALL', 'CI'];
  return Object.fromEntries(names.filter((name) => source[name] !== undefined).map((name) => [name, source[name]]));
}
export function riskReasons(dag, node) {
  const commands = (node.validation_commands ?? []).join(' ');
  if (!WRITE_KINDS.has(node.kind)) {
    return /\b(?:rm|del|Remove-Item|drop|truncate)\b|migrate\s+deploy|db:deploy|\bdeploy\b|credential|secret|password/i.test(commands)
      ? ['dangerous validation command']
      : [];
  }
  const text = [dag.task.title, dag.task.description, node.title, node.description, ...(node.affected_paths ?? []), commands].join(' ');
  const checks = [
    ['authentication/authorization', /auth|authentication|authorization|login|session|авторизац|аутентиф|сесси/i],
    ['payments', /payment|billing|invoice|acquir|плат[её]ж|оплат|инвойс|эквайр/i],
    ['credentials/secrets', /credential|secret|token|password|парол|секрет|токен|ключ/i],
    ['production infrastructure/deployment', /production|deploy|infrastructure|docker|nginx|продакш|депло|инфраструктур/i],
    ['destructive data/schema operation', /destructive|\bdelete\b|\bdrop\b|truncate|migration|удален|миграц|очистк/i],
    ['large public API change', /public api|breaking api|large api|публичн.{0,12}api|ломающ.{0,12}api/i]
  ];
  const reasons = checks.filter(([, expression]) => expression.test(text)).map(([reason]) => reason);
  if (node.risk_class && node.risk_class !== 'low') reasons.push(`declared risk: ${node.risk_class}`);
  return [...new Set(reasons)];
}
export function slug(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'task';
}

export async function loadDag(file) {
  const dag = JSON.parse(await readFile(file, 'utf8'));
  validateDag(dag);
  return dag;
}

export async function saveDag(file, dag) {
  validateDag(dag);
  const payload = `${JSON.stringify(dag, null, 2)}\n`;
  const previous = saveQueues.get(file) ?? Promise.resolve();
  const queued = previous.catch(() => {}).then(async () => {
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(temp, payload, 'utf8');
    await rename(temp, file);
  });
  saveQueues.set(file, queued);
  try { await queued; } finally { if (saveQueues.get(file) === queued) saveQueues.delete(file); }
}

export function detectCycles(dag) {
  const byId = new Map(dag.nodes.map((node) => [node.id, node]));
  const visiting = new Set();
  const visited = new Set();
  const stack = [];
  function visit(id) {
    if (visiting.has(id)) {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    if (visited.has(id)) return null;
    visiting.add(id); stack.push(id);
    for (const dependency of byId.get(id)?.depends_on ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    stack.pop(); visiting.delete(id); visited.add(id);
    return null;
  }
  for (const id of byId.keys()) {
    const cycle = visit(id);
    if (cycle) return cycle;
  }
  return null;
}

export function validateDag(dag) {
  const errors = [];
  const budgetFields = new Set(['global_rules', 'role', 'task', 'dependencies', 'repository_map', 'total']);
  const validateBudget = (budget, label) => {
    if (budget === undefined) return;
    if (!budget || typeof budget !== 'object' || Array.isArray(budget)) { errors.push(`${label} must be an object`); return; }
    for (const [field, value] of Object.entries(budget)) {
      if (!budgetFields.has(field)) errors.push(`${label}: unknown context_budget field ${field}`);
      else if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) errors.push(`${label}.${field} must be a positive finite number`);
    }
  };
  if (!dag || dag.version !== 1) errors.push('version must be 1');
  if (!dag?.task?.id) errors.push('task.id is required');
  if (dag?.task?.max_parallel !== undefined && (!Number.isInteger(dag.task.max_parallel) || dag.task.max_parallel < 1)) errors.push('task.max_parallel must be a positive integer');
  validateBudget(dag?.task?.context_budget, 'task.context_budget');
  if (!Array.isArray(dag?.nodes) || dag.nodes.length === 0) errors.push('nodes must be a non-empty array');
  const ids = new Set();
  for (const node of dag?.nodes ?? []) {
    if (!node.id) errors.push('node.id is required');
    else if (ids.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
    ids.add(node.id);
    if (!node.title || !node.description || !node.agent) errors.push(`${node.id ?? 'node'} requires title, description and agent`);
    if (node.agent && !/^[A-Z][A-Z0-9-]{1,63}$/.test(node.agent)) errors.push(`${node.id}: agent must be an uppercase role name`);
    if (!KINDS.includes(node.kind)) errors.push(`${node.id}: invalid kind ${node.kind}`);
    if (!STATES.includes(node.status)) errors.push(`${node.id}: invalid status ${node.status}`);
    for (const field of ['depends_on', 'affected_paths', 'acceptance_criteria', 'validation_commands']) {
      if (!Array.isArray(node[field])) errors.push(`${node.id}: ${field} must be an array`);
    }
    if (node.context_strategy !== undefined && !Array.isArray(node.context_strategy)) errors.push(`${node.id}: context_strategy must be an array`);
    else if (Array.isArray(node.context_strategy)) {
      try { validateContextStrategy(node.context_strategy); } catch (error) { errors.push(`${node.id}: ${error.message}`); }
    }
    validateBudget(node.context_budget, `${node.id}: context_budget`);
    if (node.depends_on?.includes(node.id)) errors.push(`${node.id}: self dependency`);
    const risks = riskReasons(dag, node);
    if (risks.length && node.human_approval !== true) errors.push(`${node.id}: human_approval=true required for ${risks.join(', ')}`);
  }
  for (const node of dag?.nodes ?? []) for (const dependency of node.depends_on ?? []) {
    if (!ids.has(dependency)) errors.push(`${node.id}: missing dependency ${dependency}`);
  }
  const cycle = errors.length ? null : detectCycles(dag);
  if (cycle) errors.push(`cycle detected: ${cycle.join(' -> ')}`);
  if (errors.length) throw new Error(`Invalid DAG:\n- ${errors.join('\n- ')}`);
  return true;
}

export function refreshDependencies(dag) {
  const byId = new Map(dag.nodes.map((node) => [node.id, node]));
  for (const node of dag.nodes) {
    if (TERMINAL.has(node.status) || node.status === 'RUNNING') continue;
    const dependenciesDone = node.depends_on.every((id) => byId.get(id).status === 'DONE');
    if (!dependenciesDone) node.status = 'BLOCKED';
    else if (node.human_approval && !node.approved_at) node.status = 'WAITING_APPROVAL';
    else node.status = 'READY';
  }
  return dag;
}

export function calculateReadyNodes(dag) {
  refreshDependencies(dag);
  return dag.nodes.filter((node) => node.status === 'READY').sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0) || a.id.localeCompare(b.id));
}

function normalizeScope(scope) { return String(scope).replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/$/, ''); }
export function pathsOverlap(left = [], right = []) {
  return left.some((a) => right.some((b) => {
    const x = normalizeScope(a); const y = normalizeScope(b);
    return x === y || x.startsWith(`${y}/`) || y.startsWith(`${x}/`);
  }));
}

export function selectParallelWave(nodes, maxParallel = Number.POSITIVE_INFINITY) {
  const selected = []; const deferred = [];
  for (const node of nodes) {
    if (selected.length >= maxParallel || selected.some((other) => WRITE_KINDS.has(node.kind) && WRITE_KINDS.has(other.kind) && pathsOverlap(node.affected_paths, other.affected_paths))) deferred.push(node);
    else selected.push(node);
  }
  return { selected, deferred };
}

export function markRunning(node) {
  if (node.status !== 'READY') throw new Error(`${node.id} is not READY`);
  node.status = 'RUNNING'; node.started_at = now(); node.attempts = (node.attempts ?? 0) + 1; node.failure_reason = null;
}
export function markDone(node, result = {}) { node.status = 'DONE'; node.completed_at = now(); Object.assign(node, result); }
export function markFailed(node, reason, result = {}) { node.status = 'FAILED'; node.completed_at = now(); node.failure_reason = String(reason); Object.assign(node, result); }

export function createFixTask(dag, failedId) {
  const failed = dag.nodes.find((node) => node.id === failedId);
  if (!failed || failed.status !== 'FAILED') throw new Error(`${failedId} is not FAILED`);
  const maximum = dag.task.max_fix_cycles ?? 3;
  const cycle = (dag.task.fix_cycles ?? 0) + 1;
  if (cycle > maximum) { dag.task.human_intervention_required = true; return null; }
  const id = `fix-${slug(failedId)}-${cycle}`;
  const fix = {
    id, title: `Fix ${failed.title}`, description: `Resolve failure in ${failed.id}: ${failed.failure_reason}`,
    agent: ['test', 'review'].includes(failed.kind) ? 'INTEGRATOR' : failed.agent,
    kind: 'fix', depends_on: [...failed.depends_on], status: 'PENDING', priority: (failed.priority ?? 0) + 1,
    affected_paths: [...failed.affected_paths], acceptance_criteria: [...failed.acceptance_criteria],
    validation_commands: [...failed.validation_commands], required: true, human_approval: failed.human_approval ?? false,
    context_strategy: [...(failed.context_strategy ?? [])], context_budget: failed.context_budget ? { ...failed.context_budget } : undefined,
    fixes_node: failed.id
  };
  if (riskReasons(dag, fix).length > 0) fix.human_approval = true;
  dag.nodes.push(fix);
  failed.depends_on = [...failed.depends_on, id]; failed.status = 'BLOCKED'; failed.failure_reason = null; failed.completed_at = null;
  dag.task.fix_cycles = cycle;
  refreshDependencies(dag);
  return fix;
}

export function retryNode(dag, id, { forceRunning = false } = {}) {
  const node = dag.nodes.find((item) => item.id === id);
  if (!node || (node.status !== 'FAILED' && !(forceRunning && node.status === 'RUNNING'))) throw new Error(`${id} is not FAILED${forceRunning ? ' or RUNNING' : ''}`);
  if ((node.attempts ?? 0) >= (dag.task.max_fix_cycles ?? 3)) { dag.task.human_intervention_required = true; throw new Error(`${id} reached retry limit`); }
  node.status = 'PENDING'; node.failure_reason = null; node.completed_at = null; refreshDependencies(dag); return node;
}

export function worktreeIdentity(dag, node, repoRoot) {
  const task = slug(dag.task.id); const item = slug(node.id);
  return { branch: `dag/${task}/${item}`, worktree: path.join(repoRoot, '.worktrees', `dag-${task}-${item}`) };
}

export async function runProcess(command, args, options = {}) {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd, shell: options.shell ?? false, windowsHide: true, env: options.env ?? safeEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    let timedOut = false;
    const timeout = options.timeoutMs ? setTimeout(() => {
      timedOut = true;
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        const fallback = setTimeout(() => child.kill(), 1000);
        killer.on('close', () => { clearTimeout(fallback); if (child.exitCode === null) child.kill(); });
      } else child.kill('SIGKILL');
    }, options.timeoutMs) : null;
    child.stdout?.on('data', (chunk) => { stdout += chunk; options.onOutput?.(String(chunk)); });
    child.stderr?.on('data', (chunk) => { stderr += chunk; options.onOutput?.(String(chunk)); });
    child.on('error', (error) => { if (timeout) clearTimeout(timeout); resolve({ code: -1, stdout, stderr: `${stderr}${error.message}`, timedOut }); });
    child.on('close', (code) => { if (timeout) clearTimeout(timeout); resolve({ code: timedOut ? -2 : (code ?? -1), stdout, stderr: timedOut ? `${stderr}Process timed out` : stderr, timedOut }); });
  });
}

export async function createWorktree(dag, node, repoRoot, runner = runProcess) {
  const identity = worktreeIdentity(dag, node, repoRoot);
  await mkdir(path.dirname(identity.worktree), { recursive: true });
  let result = await runner('git', ['worktree', 'add', identity.worktree, identity.branch], { cwd: repoRoot });
  if (result.code !== 0) result = await runner('git', ['worktree', 'add', '-b', identity.branch, identity.worktree, dag.task.base_ref ?? 'HEAD'], { cwd: repoRoot });
  if (result.code !== 0) throw new Error(`git worktree add failed: ${result.stderr || result.stdout}`);
  node.branch = identity.branch; node.worktree = identity.worktree;
  const base = await runner('git', ['rev-parse', 'HEAD'], { cwd: identity.worktree });
  if (base.code !== 0) throw new Error(`Cannot resolve worktree base commit: ${base.stderr || base.stdout}`);
  node.base_commit = base.stdout.trim();
  return identity;
}

export async function cleanupWorktree(dag, node, repoRoot, { force = false, runner = runProcess } = {}) {
  if (!node.worktree) return false;
  const expected = path.resolve(worktreeIdentity(dag, node, repoRoot).worktree);
  if (path.resolve(node.worktree) !== expected || !expected.startsWith(`${path.resolve(repoRoot, '.worktrees')}${path.sep}`)) {
    throw new Error(`Refusing unexpected worktree path: ${node.worktree}`);
  }
  const status = await runner('git', ['status', '--porcelain'], { cwd: node.worktree });
  if (status.code !== 0) throw new Error(`Cannot inspect ${node.worktree}`);
  if (status.stdout.trim() && !force) throw new Error(`Refusing to remove dirty worktree ${node.worktree}`);
  const args = ['worktree', 'remove']; if (force) args.push('--force'); args.push(node.worktree);
  const result = await runner('git', args, { cwd: repoRoot });
  if (result.code !== 0) throw new Error(`Worktree cleanup failed: ${result.stderr || result.stdout}`);
  node.worktree = null; return true;
}

function bounded(text, max = 12000) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  const half = Math.floor(max / 2);
  return `${value.slice(0, half)}\n[...truncated...]\n${value.slice(-half)}`;
}
export function extractLastAgentMessage(jsonLines) {
  let last = '';
  for (const line of String(jsonLines ?? '').split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      const candidate = event?.item?.type === 'agent_message' ? event.item.text : event?.response?.output_text;
      if (typeof candidate === 'string' && candidate.trim()) last = candidate;
    } catch { /* ignore non-JSON diagnostics */ }
  }
  return last;
}
export async function buildPrompt(dag, node, repoRoot) {
  return (await buildContextBundle(dag, node, repoRoot)).prompt;
}

async function validation(node, cwd, runner) {
  const results = [];
  for (const command of node.validation_commands) {
    const result = await runner(command, [], { cwd, shell: true });
    results.push({ command, exit_status: result.code, output: redactSecrets(bounded(`${result.stdout}${result.stderr}`, 6000)) });
    if (result.code !== 0) return { ok: false, results };
  }
  return { ok: true, results };
}

export async function executeNode(dag, node, options) {
  const repoRoot = options.repoRoot; const runner = options.runner ?? runProcess;
  const executionStarted = Date.now();
  markRunning(node);
  await options.onState?.();
  const historyDir = path.join(repoRoot, '.codex', 'dags', 'history', slug(dag.task.id));
  await mkdir(historyDir, { recursive: true });
  const resultFile = path.join(historyDir, `${slug(node.id)}-attempt-${node.attempts}.md`);
  node.result_file = resultFile;
  let cwd = repoRoot;
  try {
    if (WRITE_KINDS.has(node.kind)) { const identity = await (options.createWorktree ?? createWorktree)(dag, node, repoRoot, runner); cwd = identity.worktree; }
    const context = await buildContextBundle(dag, node, repoRoot);
    const prompt = context.prompt; node.context_metrics = context.metrics;
    const invoke = options.invokeAgent ?? (async () => {
      const sandbox = WRITE_KINDS.has(node.kind) ? 'workspace-write' : 'read-only';
      const timeoutMs = Number.parseInt(process.env.DAG_AGENT_TIMEOUT_MS ?? '900000', 10);
      const effort = process.env.DAG_CODEX_REASONING_EFFORT ?? 'medium';
      const model = process.env.DAG_CODEX_MODEL;
      const args = ['exec', ...codexToolConfigArgs(node), '-c', `model_reasoning_effort="${effort}"`];
      if (model) args.push('-m', model);
      args.push(prompt, '-C', cwd, '-s', sandbox, '--ephemeral', '--json');
      return runner('codex', args, { cwd, timeoutMs });
    });
    const agentResult = await invoke({ dag, node, cwd, prompt, resultFile });
    node.telemetry = { ...extractCodexTelemetry(agentResult.stdout), elapsed_ms: Date.now() - executionStarted };
    if (agentResult.code !== 0) throw Object.assign(new Error(`Agent failed (${agentResult.code}): ${bounded(agentResult.stderr || agentResult.stdout, 4000)}`), { failure_type: 'agent-execution' });
    const agentOutput = agentResult.output ?? extractLastAgentMessage(agentResult.stdout);
    if (!String(agentOutput ?? '').trim()) throw Object.assign(new Error('Agent completed without a final response'), { failure_type: 'agent-protocol' });
    await writeFile(resultFile, `${redactSecrets(agentOutput)}\n`, 'utf8');
    if (node.review_verdict_required) {
      const report = await readFile(resultFile, 'utf8');
      const verdict = report.trimStart().match(/^(PASS|BLOCK|FAIL)\b/i)?.[1]?.toUpperCase();
      if (!verdict) throw Object.assign(new Error('Verification report must begin with PASS, FAIL, or BLOCK'), { failure_type: 'review-protocol' });
      if (verdict !== 'PASS') throw Object.assign(new Error(`Verification blocked: ${bounded(report, 4000)}`), { failure_type: 'review-blocker' });
    }
    const checked = await validation(node, cwd, runner);
    if (!checked.ok) throw Object.assign(new Error('Validation failed'), { validation_result: checked, failure_type: 'validation' });
    if (WRITE_KINDS.has(node.kind)) {
      const head = await runner('git', ['rev-parse', 'HEAD'], { cwd });
      const clean = await runner('git', ['status', '--porcelain'], { cwd });
      if (head.code !== 0 || clean.code !== 0 || clean.stdout.trim()) throw new Error('Write node must finish with a clean committed worktree');
      if (!node.base_commit || head.stdout.trim() === node.base_commit) throw Object.assign(new Error('Write node did not create an assigned commit'), { failure_type: 'task' });
      node.commit = head.stdout.trim();
    }
    markDone(node, { exit_status: 0, validation_result: checked }); await options.onState?.();
    return { ok: true, node };
  } catch (error) {
    const safeError = redactSecrets(error.message);
    markFailed(node, safeError, { exit_status: error.exit_status ?? 1, validation_result: error.validation_result ?? null, failure_type: error.failure_type ?? 'orchestrator' }); await options.onState?.();
    try { await writeFile(resultFile, `# Failure\n\n${safeError}\n`, 'utf8'); } catch { /* keep primary error */ }
    return { ok: false, node, error };
  }
}

export async function runDag(dag, options) {
  validateDag(dag); const events = [];
  const persist = options.onState ?? (options.stateFile ? async () => saveDag(options.stateFile, dag) : undefined);
  while (true) {
    const ready = calculateReadyNodes(dag);
    if (ready.length === 0) break;
    const { selected, deferred } = selectParallelWave(ready, dag.task.max_parallel ?? 4);
    events.push({ type: 'wave', nodes: selected.map((node) => node.id), deferred: deferred.map((node) => node.id) });
    const results = await Promise.all(selected.map((node) => executeNode(dag, node, { ...options, onState: persist })));
    for (const result of results) if (!result.ok && options.autoFix && result.node.kind !== 'fix' && ['validation', 'task', 'review-blocker'].includes(result.node.failure_type)) {
      const fix = createFixTask(dag, result.node.id); events.push({ type: fix ? 'fix-created' : 'human-required', node: result.node.id, fix: fix?.id });
    }
    if (options.stateFile) await saveDag(options.stateFile, dag);
    if (results.every((result) => !result.ok) && !options.autoFix) break;
  }
  refreshDependencies(dag);
  const required = dag.nodes.filter((node) => node.required !== false);
  return { dag, events, complete: required.every((node) => node.status === 'DONE') };
}

export function showStatus(dag) {
  refreshDependencies(dag);
  const lines = [`${dag.task.title} [${dag.task.id}]`, `fix cycles: ${dag.task.fix_cycles ?? 0}/${dag.task.max_fix_cycles ?? 3}`];
  for (const node of dag.nodes) lines.push(`${node.status.padEnd(18)} ${node.id.padEnd(30)} ${node.agent}`);
  return lines.join('\n');
}

export function renderGraph(dag, mermaid = false) {
  if (mermaid) {
    const lines = ['flowchart TD'];
    for (const node of dag.nodes) lines.push(`  ${slug(node.id).replaceAll('-', '_')}["${node.id}\\n${node.status}"]`);
    for (const node of dag.nodes) for (const dependency of node.depends_on) lines.push(`  ${slug(dependency).replaceAll('-', '_')} --> ${slug(node.id).replaceAll('-', '_')}`);
    return lines.join('\n');
  }
  return dag.nodes.map((node) => `${node.id} <- ${node.depends_on.join(', ') || '(root)'}`).join('\n');
}

export async function removePath(target) { await rm(target, { recursive: true, force: true }); }
