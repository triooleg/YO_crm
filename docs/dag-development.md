# DAG Lite development workflow

## 1. Purpose and boundary

DAG Lite coordinates Codex development agents for this repository. It is local development tooling only: the CRM runtime, API, Prisma schema, business data, Docker stack, and production deployment do not depend on it.

## 2. Quick start

```powershell
pnpm dag plan "Describe the change"
pnpm dag validate
pnpm dag graph --mermaid
pnpm dag status
pnpm dag run
```

Use `pnpm dag demo` to install the safe read-only Orders example or `pnpm dag smoke` for the context-routing smoke workflow. State is stored in `.codex/dags/current.json`; compact agent evidence is stored in `.codex/dags/history/<task>/`.

## 3. DAG definition

The JSON document has `version`, task metadata, and nodes. Every node declares a stable ID, uppercase role name, kind, dependencies, state, priority, affected paths, acceptance criteria, validation commands, whether it is required, and whether it needs human approval. JSON was chosen to avoid a runtime YAML dependency and make state updates deterministic.

## 4. States

- `PENDING`: created but not yet evaluated.
- `BLOCKED`: at least one dependency is not `DONE`.
- `READY`: dependencies are done and the node may run.
- `WAITING_APPROVAL`: dependencies are done but a human gate is closed.
- `RUNNING`: an agent or validation command is active.
- `DONE`, `FAILED`, `CANCELLED`: terminal result states.

The validator rejects duplicate or missing IDs, missing dependencies, malformed arrays, unknown states/kinds, self-dependencies, and cycles. Cycle errors include the cycle path.

## 5. Roles

Role contracts live in `.codex/agents`: `ARCHITECT`, `PLANNER`, `FRONTEND`, `BACKEND`, `DATABASE`, `INTEGRATOR`, `TESTER`, `REVIEWER`, `DEVOPS`, `SECURITY`, and `UI-QA`. Repository `AGENTS.md` and existing `.agents` review contracts remain authoritative.

## 6. Planning

`pnpm dag plan` creates a deterministic scaffold: analysis, planning, parallel frontend/backend/database implementation, integration, tests, and review. The planner agent may recommend a refined DAG, but the CLI never silently broadens file ownership or risk permissions. Edit and validate JSON before execution when the scaffold is wider than the real task.

Planner also selects the narrowest useful `context_strategy` for each node. Context routing, budgets, compact dependency handoffs, repository-map cache, optional Serena/Repomix/Context7 adapters, feature flags, and rollback are documented in `docs/codex/tooling.md`. These additions do not alter node states, scheduling, worktrees, or integration ownership.

## 7. Parallel execution and conflicts

Ready nodes are sorted by priority. Nodes in the same wave run concurrently except write nodes with equal, parent, or child affected paths. `task.max_parallel` bounds provider concurrency (default 4). Conflicting or capacity-exceeding nodes are deferred and reported in wave history. Declared paths are a scheduling contract, not a substitute for review.

## 8. Git worktrees

Analysis, test, and review nodes run read-only in the repository. Implementation, integration, and fix nodes use `.worktrees/dag-<task>-<node>` and branch `dag/<task>/<node>`. Write nodes must finish with a clean committed worktree. Cleanup refuses dirty worktrees unless `--force` is explicitly supplied and never deletes branches automatically.

## 9. Integration

Implementation agents commit only their assigned paths and never use `git add .`; a write node cannot finish without producing a new commit. Only `INTEGRATOR` may combine dependency commits in a separate worktree, using the recorded dependency branches and commit hashes. It inspects commits, handles semantic conflicts conservatively, and validates the result. DAG Lite never merges to `main`, pushes, or deploys.

## 10. Testing and review

Nodes define focused validation commands. `TESTER` checks acceptance evidence without fixing code and begins its verdict with `PASS` or `FAIL`. `REVIEWER` begins with `PASS`, `FAIL`, or `BLOCK` and applies correctness, regression, security, business-rule, visual-applicability, and release evidence gates. Non-PASS verdicts block dependants and create a bounded FIX node when automatic fixes are enabled. The repository-level completion gate remains `pnpm quality:check` plus relevant live smoke evidence.

## 11. Failures and bounded fixes

Failures record their reason, type, exit status, timestamps, validation output, branch, worktree, commit, and result file. With automatic fixes enabled, a validation failure inserts `fix-<node>-<cycle>` and the failed node is rerun after it. CLI/auth/tool failures do not create misleading code fixes. The default maximum is three task-wide fix cycles; after that `human_intervention_required` is set. `retry` also enforces the configured attempt limit; use `retry <node> --force-running` only after confirming an interrupted agent no longer runs. Agent execution defaults to a 15-minute timeout and medium reasoning; override these with `DAG_AGENT_TIMEOUT_MS`, `DAG_CODEX_REASONING_EFFORT`, and optional `DAG_CODEX_MODEL` when justified.

## 12. Human approval

Explicit approval is required for destructive migrations or deletion, authentication/authorization, payments, credentials or secrets, production infrastructure, deployment, and large public API changes. Validation enforces this for hand-edited write nodes, not only generated plans. Such nodes remain in `WAITING_APPROVAL` until `pnpm dag approve <node>`. Approval does not authorize a merge or deployment.

Child processes receive a minimal operating-system/Codex allowlist instead of the full shell environment. Codex final responses are parsed from JSONL, common secret forms are redacted, and only the sanitized final report is persisted. Do not place secrets in prompts, DAG files, validation commands, or repository files.

## 13. CLI reference

```text
plan <task>              create a scaffold
demo                     install the read-only Orders example
smoke                    install the context-routing smoke example
validate                 validate schema and cycles
status                   display states and roles
context [node]           display routing/context metrics without prompt text
repo-map [--refresh]     display or rebuild the lightweight repository map
run [node]               run all available waves or one ready node
retry <node>             retry failure; --force-running recovers a crash
approve <node>           open an explicit human gate
cancel <node>            cancel a non-terminal node
graph [--mermaid]        render dependencies
cleanup <node>|--all     remove clean worktrees; --force is explicit
```

## 14. Adding a role and disabling the tool

Add a lowercase Markdown role file under `.codex/agents`, reference its uppercase name in a node, document its permissions and exclusions, then add a small execution test. To disable DAG Lite, stop invoking `pnpm dag*`; it has no daemon or production hook. To remove it, delete `tools/dag`, `.codex/agents`, `.codex/dags/templates`, these two DAG documents, the root DAG scripts, and DAG ignore entries. Preserve history first if audit evidence is needed.

## Orders demonstration

The demo maps Orders, runs frontend/backend/database analysis in parallel, and consolidates findings. Every node is read-only, has no validation command that changes state, and cannot create a worktree. This demonstrates scheduling and evidence collection without changing CRM behavior.

The context smoke workflow uses the same read-only Orders payment-analysis shape and additionally exercises strategy selection, Serena/Repomix fallbacks, sibling isolation, compact handoffs, and telemetry. It never changes production code.
