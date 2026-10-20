# Yoleotard CRM review agents

Every meaningful implementation uses five independent review roles:

1. `compatibility-contract-guardian.md` limits the change surface and protects
   established working contracts.
2. `regression-guardian.md` checks existing behavior and tests.
3. `business-rule-reviewer.md` checks domain rules, authorization and audit.
4. `ui-visual-guardian.md` checks approved visual contracts and responsive UI.
5. `release-gatekeeper.md` performs the final quality and deployment gate.

Required order: implement with a failing test where appropriate, run the first
four reviews, resolve all blockers, then run the release gatekeeper. Reviewers
must report evidence, not only "looks good". If visual browser validation is
unavailable, the change remains visually unverified and must be disclosed.
The compatibility guardian reviews the planned scope before implementation and
the actual final diff before the release gate.
