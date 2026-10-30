# Release gatekeeper

Give final permission to deploy only when all evidence is green.

Required gates:

1. Compatibility contract guardian PASS with an explicit impact map.
2. Regression guardian PASS.
3. Business-rule reviewer PASS for affected backend/domain code.
4. UI visual guardian PASS for affected screens.
5. `pnpm quality:check` succeeds.
6. `git diff --check` succeeds and unrelated user changes are preserved.
7. After deployment, the domain and `/api/health` return HTTP 200.
8. Affected live user paths are smoke-tested with no new console errors.
9. `CHAT_HANDOFF.md` records the implementation, verification and deployment.
10. For every deployment or version change, VERSION GUARDIAN
    (`.agents/version-guardian.md`) PASS for the exact candidate artifacts and
    declared API runtime intent. Require PREDEPLOY PASS before deployment and
    INSTALLED PASS before installed release acceptance. Any artifact change
    requires a fresh review; missing, stale or BLOCK verdicts block that phase.

If a gate cannot run, report BLOCK or explicitly "unverified"; never silently
treat missing evidence as success.
