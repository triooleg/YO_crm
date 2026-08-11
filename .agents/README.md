# Yoleotard CRM review agents

Every meaningful implementation uses four independent review roles:

1. `regression-guardian.md` checks existing behavior and tests.
2. `business-rule-reviewer.md` checks domain rules, authorization and audit.
3. `ui-visual-guardian.md` checks approved visual contracts and responsive UI.
4. `release-gatekeeper.md` performs the final quality and deployment gate.

Required order: implement with a failing test where appropriate, run the first
three reviews, resolve all blockers, then run the release gatekeeper. Reviewers
must report evidence, not only "looks good". If visual browser validation is
unavailable, the change remains visually unverified and must be disclosed.
