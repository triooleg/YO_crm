## Operational history implementation 0.13.0

Controlled single-client history execution, owner confirmation, exact backup/drill
grant and selective rollback are implemented. Intake/planning/operational flags
default OFF. Existing49 migration leaves are preserved; three additive history
migrations require reviewed deployment. After any operational run, including a
rolled-back run, API historical ingress guard1 remains required. Source completeness
and ambiguous media remain separate acceptance checks. Runtime/deployment evidence
is recorded separately; this source handoff does not claim a completed import.
No browser automation, source credentials or private captures are shipped.
See docs/operations/HISTORY_MIGRATION.md.

## 2026-11-01 — 0.12.12 archive Inbox reader

API and web use snapshot
`ba0c6f92be5241b342a30a1f5b36d2af893dd385985707a37071ae94071a7801`.
Archive messages preserve per-dialogue order within minute ties. Inbox displays
source time precision and unavailable attachment inventory without inventing links.
Ordinary messaging, authorization and finance are unchanged. No historical writer,
schema migration, seed or operational history import is included in this release.
See `docs/release-evidence/history-reader-deployment-2026-11-01.md` for acceptance.
Publish exact reviewed release source to GitHub with every deployment. Private
operational handoffs, source captures, sessions and customer screenshots stay local.

# Technical handoff — 0.12.11 accepted installed

Version 0.12.11 is accepted installed: engineering, version, release, visual and read-only live checks passed for API and web. Source snapshot: e1e473e7918243179d0bdeecf4a0bd80b0c64f485c52e25f306f5215ef3950cb. Baseline: 0.12.10, snapshot 074d0d5ee71f3d00e73fac2803c16859840a9b06c611b3fa304e5dcc5880972d.

The release adds localized contact-copy actions using existing Mantine controls. Existing editing behavior remains covered. The release increment changes no API runtime, database schema or financial behavior.

Source publication base: 8378b45fd1f0d6f89eae8409a349edb0f88c2499. Its 1,374 non-handoff candidate files match the frozen source bytes exactly. CHAT_HANDOFF.md is an approved documentation-only privacy substitution; three pre-existing remote-only evidence documents are preserved. Publication evidence and subsequent documentation updates do not imply all 1,375 candidate files are byte-identical.

Quality and live verification are summarized in docs/release-evidence/contact-copy-deployment-2026-10-30.md. Clipboard behavior was tested using a browser Clipboard API stub; an operating-system clipboard write was not verified.

Installed image pins: API sha256:f856441dd06f59db98b209ba4b66e033e3b252fdc5ef69a6c7c971b86ab19c88; web sha256:3f6eba7f2104ecc7b42da8331eed7696a56e809a1fff70963bb063b4e13ee3d0. Post-deployment retention passed at 5 rollback sets, 5 releases, 5 API images and 5 web images. The backup executor is resumed and AVAILABLE with one owned cron entry; foreign cron and agent settings are preserved. Final installed release and visual reviews passed. This accepted record accompanies the main-branch fast-forward after installed acceptance.

Owner policy: GitHub must reflect the reviewed source for every deployment, including service-only releases and rollback. Publish the reviewed release branch before staging; fast-forward main after installed acceptance. Preserve remote-only development material unless removal is separately justified. Publish sanitized technical evidence only; exclude credentials, customer data, signed URLs and private operational history. Record actual deployment pins separately. No force-push.
