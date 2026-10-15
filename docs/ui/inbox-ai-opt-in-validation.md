# Inbox: explicit AI reply control

Local change against `bea2865888104e45bed57573ae815abf9d3628e7` (2026-10-15).
The user subsequently authorized deployment as CRM 0.4.1. This document records
local acceptance; installed verification is recorded separately after the switch.

## Reported behavior and diagnosis

The operator reported text appearing after a new client message without requesting
an AI reply. A synthetic browser test reproduced insertion of a previously saved
server DRAFT into an empty composer during incoming-message polling, while the AI
panel was off. The request trace contained zero AI-generation POSTs and no draft
mutation or send. This demonstrates unsolicited draft restoration, not a newly
generated model reply. Current ingress/worker source has no automatic reply
generation path; incoming-message analysis is a separate feature.

## Change and retained contracts

- Remove poll-triggered composer draft restoration. Explicit client opening and
  channel switching still restore saved text, draft ID/key and AI provenance.
- Add a Mantine AI reply switch beside the existing panel heading, off initially.
  Enabling opens the reply tools without making a generation request. Generation
  remains an explicit button action. The existing heading toggle stays synchronized.
- Disabling invalidates pending assistant results and clears its transient preview,
  preserving the main composer and saved history. A provider request already
  accepted may finish remotely; its late UI result is ignored.
- This is a local conversation reply control. It does not change global AI policy,
  message translation, summaries, provider settings, credentials, APIs or storage.
  It does not send any reply automatically.

## Validation

Validation receipts are recorded privately under `.local/inbox-ai-opt-in`.
The original actual poll reproduction is retained in the isolated regression
worktree's `red-actual-poll.log`. Initial harness timing/interaction failures are
distinct from this product RED and are not represented as passing tests.

Independent compatibility and business/security source reviews passed. The visual
review inspected actual synthetic OFF/ON screenshots at 1366×900 and 390×844:
the switch, labels, composer and manual send remain usable in the existing layout.
These resting frames do not prove provider behavior or a real customer send.

Automated browser regression: 9 passed against an isolated source copy, covering
incoming polling with AI/manual saved drafts, typed-text preservation, initial and
channel restoration with manual send/provenance, OFF/ON synchronization at both
widths, explicit one-request generation and rejection of a held late response
after OFF. API responses and delivery are intercepted fixtures; there are no real
model calls, customer sends or production mutations.

`pnpm quality:check` passed: 1594 tests (1082 API, 488 web, 24 database), workspace
typechecks and API/Next production builds. The generated Next ambient declaration
was restored to its original tracked content and the web typecheck passed again.
The obsolete source assertion requiring the removed hydration effect was removed;
the behavioral browser regression is the causal guard for this bug.

All five independent review roles passed the local scope, including the final
quality gate. The tested source manifest matched 114/114 files; final web
typecheck also passed with the new browser test included. Release preparation
adds only version metadata and updates the existing release-version expectations.
