# CRM 0.4.1 — Inbox AI reply control

Deployed 2026-10-15 after the user's explicit deployment request.

- Immutable source/tag: `5c9a8d893c80c78f0005daa9cf7fb6f44063eb29` / `crm-v0.4.1`.
- WEB image: `sha256:63e1e333d2a78151f3306206c553e0c59791944047cae485662880081fa24846`.
- API remains the existing 0.4.0 image/container; API, PostgreSQL and Redis were
  not stopped or recreated. No schema migration, seed, backfill or profile replay.

The Inbox reply tools now have a visible AI switch, initially off. Enabling opens
the tools without requesting generation. Saved drafts are restored when opening a
client or changing channel; background polling no longer inserts an old draft into
an empty composer. Disabling ignores late assistant results. Generation and
sending remain explicit actions. Global AI policy, translations and summaries are
separate controls. See [local validation](inbox-ai-opt-in-validation.md).

## Checks and recovery

Pinned pnpm 11.16.0 quality check passed: 1594 tests, workspace typechecks and
API/Next builds; generated Next ambient declaration restored, final web typecheck
passed. Nine synthetic browser cases passed. GitHub Quality gates 38802965264 and
CRM release 38802956353 both succeeded for the exact deployed commit.

Fresh FULL backup `20261015T202841Z-c187304-pre-v041` passed checksums, dump catalog,
upload archive and manifest checks. The immutable source archive contains 821
files and preserves all 36 historical SQL migration files byte for byte. Independent
review approved the exact helper, isolated WEB build and subsequent WEB-only
switch. The old source and image are retained for compatible WEB recovery; no
database restoration is part of this release.

Archive SHA256: `601fd7594c62ac259f03618988464b9afb7e8a84b2b472e2dea26da22d7b5e56`.
Source manifest SHA256: `c8ecfcd82fbca5f9e4dafb8cc3cce378df87851cc4d54e346d97ccff8944cbf7`.

## Installed verification and limits

Actual authenticated read-only smoke: 12 checks passed, four OFF/ON screenshots
at 1366×900 and 390×844. Installed version, switch synchronization, natural
polling and unchanged empty composer verified. Zero generation attempts, customer
writes, blocked requests or browser errors in the successful run. No client text
was entered or sent; authentication sessions were closed. Root and health return
HTTP 200, required dependencies are up.

No naturally arriving inbound-plus-DRAFT occurred during either observed window;
those two live causal cases remain UNAVAILABLE. The reproduced original mechanism
and its fix are proved by the nine local synthetic cases, not by a fabricated
production event or a real model/send operation.

The first smoke failed because its allowlist excluded the existing selected-channel
GET used to validate a conversation deep link. That failed receipt/helper remain
preserved. A separately reviewed narrow allowlist/wait correction passed without
any application change or weakening mutation guards.

Final strict post window: `20:38:28.247257Z–20:44:19.957471Z`. All 22 business-table
full-column fingerprints plus operation history and the full 36-row migration
tracker remained equal. API/PG/Redis identity, private configuration and storage
mount pins remained unchanged; WEB source/image/health matched. Retained old/new
API/WEB stdout and stderr scans passed over the complete interval. API remained
active: these are bounded sampled equality checks, not writer-quiescence proof.

Private operational, browser and visual evidence: `.local/inbox-ai-deploy`.
Independent actual visual review and final release gate accepted this bounded
deployment; no blocking findings remain. The two unavailable causal live cases
retain the limits above.
