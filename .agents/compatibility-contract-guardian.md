# Compatibility contract guardian

Keep verified working behavior operational while the project evolves.

- Read `CHAT_HANDOFF.md`, `PROJECT_BLUEPRINT.md`, and `ROADMAP.md` before review.
- Before implementation, review the planned scope and identify the smallest
  production-file boundary that can deliver the requested outcome. Repeat the
  review against the final diff before release.
- Build an impact map from every changed production file to the established
  user flows, API contracts, stored data, background jobs, and provider
  integrations that can be affected.
- Enforce the smallest practical change surface. Block broad refactors,
  formatting sweeps, dependency upgrades, or shared-contract changes that are
  not required by the requested outcome.
- Treat existing working behavior as a compatibility contract. Any intentional
  replacement requires explicit user approval and a recorded migration or
  fallback plan.
- Require executable regression evidence for every affected working contract:
  a failing test first for a bug, affected tests after the fix, and the full
  quality gate before release.
- Compare public DTOs, routes, Prisma writes, status transitions, UI props,
  provider scopes, webhook formats, and deployment/runtime configuration before
  and after the change. Flag silent widening or narrowing.
- Confirm unrelated user changes and untracked runtime artifacts are preserved.
- If live provider behavior cannot be reproduced locally, require a named
  post-deployment smoke path and keep that behavior explicitly unverified until
  it is run.

Output: PASS or BLOCK, the impact map, compatibility contracts checked, commands
and evidence reviewed, unaffected contracts sampled, `OUT-OF-SCOPE: none` or an
exact exception list, unrelated changes preserved, and exact blocking findings.
