# Codex development tooling

## Boundary

This layer optimizes the existing DAG; it is not a second orchestrator. It is used only by local development commands under `tools/dag`. The CRM runtime, production containers, Git isolation, node states, scheduling, integration, tests, and reviews remain owned by the existing workflow.

## Tool decisions

| Tool | Purpose | Benefit | Token impact | Performance impact | Risks / duplication | Recommendation |
| --- | --- | --- | --- | --- | --- | --- |
| Built-in repository map | Compact paths and exported symbols | Cheap architecture orientation and fewer broad reads | Small bounded section | Cached; fingerprint scan remains local | Regex outline is not a semantic index | Enabled by default |
| Serena | Symbol lookup, references, targeted reading | Can avoid reading large files | Tool definitions only on selected nodes | Starts an MCP/LSP process and may index the repository | Duplicates normal search; host currently has no `uv`/Python/Serena | Optional, disabled by default |
| Repomix | Architecture snapshot for unfamiliar or broad modules | Useful for Architect/Planner only | Potentially large, therefore hard bounded | `npx` startup was materially slower than the built-in map | Full output exceeded the target budget in evaluation | Optional pinned adapter, disabled by default |
| Context7 | Version-specific external library documentation | Reduces API/version guessing | Tools only on explicitly routed nodes | Remote MCP latency | Must not replace repository/package inspection | Optional lazy MCP, disabled by default |

No package from this table is a production dependency. Serena and Context7 are not registered globally. Repomix is not added to `package.json`; the optional adapter invokes the pinned `repomix@1.18.0` through `npx` and fails back safely.

Official references: [Serena Codex setup](https://oraios.github.io/serena/02-usage/030_clients.html), [Repomix MCP](https://repomix.com/guide/mcp-server), [Repomix configuration](https://repomix.com/guide/configuration), and [Context7 client setup](https://context7.com/docs/resources/all-clients).

## Context routing and isolation

Each node may declare `context_strategy` using `repository`, `repository_map`, `targeted_search`, `serena_symbols`, `serena_references`, `repomix`, or `context7`. Planner/Architect default to a repository map plus targeted search. Coding nodes request symbol/reference navigation and safely fall back to targeted search. Integrator, Tester, and Reviewer use repository evidence and targeted search.

Every prompt contains only compact global rules, the role contract, the node task, direct dependency summaries, and the selected repository overview. Sibling transcripts are not propagated. Completed nodes should end with `HANDOFF_SUMMARY` JSON containing `node_id`, `result`, `files_changed`, `public_interfaces_changed`, `database_changes`, `important_decisions`, `risks`, `tests`, and `commit`. Invalid or missing structured output receives a deterministic bounded fallback summary.

Search order is: exact symbol, references, exact filename, scoped search, repository map, then broad search. Large files should be outlined before relevant fragments are read.

## Budgets, cache, and telemetry

Budgets are character bounds used as engineering targets, not provider API limits. Defaults are global rules 9,000, role 4,000, task 6,000, dependencies 9,000, repository map 10,000, total prompt 30,000 characters. Tasks or nodes may override them through `context_budget`.

The repository map caches only paths and public symbol names in `.codex/cache/repo-map.json`. A content fingerprint (with a metadata fallback only for files above 256 KB) invalidates after relevant source changes, including same-size edits; `pnpm dag repo-map --refresh` forces rebuilding. Source content, Git state, DAG state, database state, migrations, customer data, and secrets are not stored in the cache. Generated cache and Repomix output are ignored by Git.

Per-node history records context characters/bytes, approximate input tokens (characters divided by four), strategy/fallbacks, elapsed time, tool calls, repository-read calls, and detected large reads. Exact provider token counts are not available from the current CLI event stream and are never presented as exact.

## Feature flags

```text
CODEX_CONTEXT_OPTIMIZATION_ENABLED=true
CODEX_CONTEXT_BUDGET_ENABLED=true
CODEX_REPO_MAP_ENABLED=true
CODEX_REPO_MAP_CACHE_ENABLED=true
CODEX_MINIMAL_TOOL_SURFACE_ENABLED=false
CODEX_SERENA_ENABLED=false
CODEX_REPOMIX_ENABLED=false
CODEX_CONTEXT7_ENABLED=false
```

MCP configuration is added to a child Codex process only when its node requests the corresponding enabled strategy. The current environment exposes only two built-in MCP servers. Attempts to remove user configuration with `--ignore-user-config` also removed required sandbox/approval policy, while partial transport overrides were rejected by Codex, so `CODEX_MINIMAL_TOOL_SURFACE_ENABLED` remains off. This is safer than breaking read-only agents; Serena and Context7 still stay absent unless a selected node explicitly enables them.

## Commands

```powershell
pnpm dag context
pnpm dag context backend-orders
pnpm dag repo-map
pnpm dag repo-map --refresh
pnpm dag smoke
pnpm dag:benchmark
```

`pnpm dag context` reports metrics and routing without printing the prompt. `pnpm dag smoke` installs the read-only Orders payment-analysis workflow.

## Fallback and troubleshooting

- Serena unavailable: `serena_symbols` and `serena_references` become `targeted_search`.
- Repomix disabled, offline, timed out, or failed: the node receives the built-in repository map.
- Context7 disabled or unavailable: the node continues from repository evidence; it must report any unresolved version-specific uncertainty.
- Cache write/read failure: a fresh in-memory map is used.
- Disable all optimization: set `CODEX_CONTEXT_OPTIMIZATION_ENABLED=false`; the legacy prompt path remains available.
- Do not enable `CODEX_MINIMAL_TOOL_SURFACE_ENABLED` until the installed Codex version provides a safe supported way to filter existing MCP tools without replacing authentication or policy configuration.

To remove the layer completely, stop using the context flags, remove `tools/dag/context.mjs`, the context commands/tests/templates, `repomix.config.json`, `.repomixignore`, and these documentation sections. The DAG state machine and CRM remain independently usable.

## Measured evaluation

The five-sample baseline recorded local Codex CLI process startup at 41.0 ms, DAG status at 732.9 ms, deterministic planning at 757.5 ms, repository scan at 24.5 ms, average node context at 4,299 characters (approximately 1,075 tokens), and DAG tests at 3,350 ms. This Codex startup measurement is process startup (`codex --version`), not remote-model latency.

An apples-to-apples generated-prompt comparison on the current `dag-tooling-review` state measured 4,673 average characters before and 3,599 after, a 1,074-character (23.0%) reduction. The largest saving comes from replacing full prior reviewer reports with direct compact dependency summaries.

The same five-node Orders analysis was also executed end to end in both modes with `gpt-5.4-mini` at low reasoning. Legacy completed in 193,482 ms and optimized in 154,079 ms (39,403 ms / 20.4% faster in this single sample). Average node prompt size was 5,051 versus 4,762 characters (5.7% lower); estimated total prompt tokens were 6,315 versus 5,955; tool calls were 61 versus 37; file-read calls were 59 versus 29; detected large reads were 11 versus 0. Both runs reached 5/5 `DONE`. Timing is a one-run observation, not a guaranteed speedup.

Final verification: `pnpm dag:test` passed 45/45; `pnpm quality:check` passed 380 repository tests plus typecheck and build; the existing Orders demo reached 5/5 `DONE`; compatibility, regression, business/security, visual-applicability, and final release reviews passed. Docker Compose validation was unavailable because the host has no Docker CLI; Compose files and production dependencies were not changed.
