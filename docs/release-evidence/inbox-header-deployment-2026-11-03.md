# Inbox header cleanup — installed 0.14.1

Owner authorized deployment and GitHub publication. Application commit
`8acb2e489c0180d59d086891c4a5f863b99f8c74` was verified on origin/main before
cutover. The header no longer repeats the country beside the client name or
the single-channel account beside its actions. Primary channel/account badges,
profile link, actions, multi-channel reply selector and sidebar country remain.

## Artifact identity

- Frozen source: `189e4bcc4ab5d6af11d1f6398bb351b4b602ee2e6cbb2e3c7f0ff223b417f29a`.
- API: `sha256:b5fc3b0c8ea81f9d0486654c2fcf9e085154345d215228a312eb6f568f2fb052`.
- Web: `sha256:317494dc9bd6c13e02ec889b06c4d00f39c8d21362b4f14c64053d72ebfb222b`.
- Plan: `2a524a18c888ac4fa323cea96ed0b83a2de93038a43b1f71be11264046fbddde`.
- Operator: `d736a5a5bbeec60e769e181299dcc3c3a8058db8aa691a19d0c5ba0fca631bc1`.

Both services were rebuilt as 0.14.1; API business logic and schema53 are
unchanged. The existing guarded operator installed nine audited leaves: six
task/version paths and three published 0.14.0 documentation/DAG reconciliations.
Historical absent-file exceptions remain explicit. No migration, seed,
production restore, message send or provider refresh was used as a smoke test.

## Verification and recovery

Exact-version quality passed: 3244 tests, 109 optional skips, zero failures,
typechecks and both production builds. Existing operator tests also passed on
Linux 45/45 without skips. Compatibility, regression, business/security, scoped
visual and predeploy version/release reviews passed.

Local real-component screenshots cover single/multiple channels at 1920, 1366
and 390px. Existing multichannel 1366 overflow remains outside this removal-only
change; no paired baseline establishes an overall overflow pass.

Fresh DATA `pre-inboxheader-0141-189e4bcc4ab5` passed independently validated
writer quiescence and an isolated offline restore with cleanup. The offline
drill's sourceConsistent=false is retained; host capture consistency is separate
evidence. No production recovery-time claim is made.

The operator emitted its terminal APPLIED result after coordination contexts
unwound; PID absence and free gate, lease and flocks were independently checked.
The detached launcher does not provide a verified process exit code. All four
services are healthy, original PostgreSQL/Redis remain, and immutable metadata,
emitted web identity and authenticated brand/journal agree on 0.14.1/full source.

Authenticated Inbox smoke confirmed one primary channel badge, no right-side
duplicate or header country chip, preserved sidebar country/actions, and no
console errors. The previously owner-confirmed October tax reconciliation also
remained complete after restart; receipt details stay private.

Existing retention owner removed one unused old upload cache and two old image
tags after exact identity/reference checks. Fresh post-cutover inventory is
five releases/five rollback sets/five API/five web images. Backups and volumes
were preserved. Private technical receipts and screenshots remain under ignored
`.local/inbox-header-deploy`; no customer data or credentials are published here.

Browser-verified installed proof:
`931a1a7dbb6f0a1ee3aad9e17233a26fb72e37615421734f874fd202261cfdcc`.
The host deployment pointer was reconciled by exact prior-byte/metadata CAS
after reviewed proof and closed coordination. Prior bytes were preserved in
the create-only intent; separate current provenance records the installed
artifacts. Evidence-only documentation publication does not change runtime.

Independent Version Guardian INSTALLED and final RELEASE INSTALLED reviews
passed for these exact runtime artifacts, actual browser evidence, pointer CAS,
provenance and post-retention receipts. No unknown deployment outcome remains.
