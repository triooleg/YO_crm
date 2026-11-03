# Client merge safety worker

Base: `c91c747`. Implementation is an uncommitted worker patch. No deployment,
provider request or production data access. Parent owns controller/primary DTO/
module wiring and the canonical root handoff; none are edited here.

## Parent integration contract

Import `ClientMergePreviewDto` and `ClientMergeBatchDto` from
`apps/api/src/clients/client-merge-workspace.dto.ts`. Wire the existing
OWNER/ADMIN/MANAGER guards to:

- `POST :id/merge-preview` -> `previewMerge(id, dto)`.
- `POST :id/merge-batch` -> `mergeBatch(id, dto, actor)`.

Preview body: `{sourceClientIds: string[], fieldChoices?: {field: clientId}}`.
There must be 1..9 distinct sources and the target must not be a source.
Batch additionally requires the exact `previewToken` returned as preview `token`.
Source order is canonical (lexical ID order); a reordered selection has the same
token. Changing choices requires another preview.

Preview returns `{token, clients, conflicts, fieldChoices}`. Each client exposes
ID, display name, updatedAt, allowed contact/profile fields and counts for orders,
athletes, measurements, conversations, messages, files, tasks, payments, notes
and sources. Counts include archived relations because those also move.
It does not expose AI settings; their complete content contributes to the hash.
`conflicts` contains `{code, clientIds, field?}` blocking findings. The parent
must localize codes in its Russian dictionary.

Choice whitelist: displayName, firstName, lastName, avatarUrl, country, city,
address, postalCode, language, timezone, preferredChannel, email, phone, whatsapp,
instagram, instagramUsername, facebook, telegram. Choices name existing clients,
not arbitrary new values. Choosing a different email/phone/social identity over
a nonempty original target identity is blocked: no durable target alias exists.
Names alone never trigger a merge. Same-channel (even archived) conversations
and incompatible AI runtime settings remain blocking.

Both preview and batch acquire the global merge lock, sorted client advisory
locks and row locks. Batch recomputes the token inside that transaction before
any write. The token covers complete scalar profiles/preferences, ownership IDs,
conversation identity and AI settings. Nested message/payment/measurement
counts are informational aggregates, not freshness-token inputs: these rows
retain their unchanged parent foreign keys when parent ownership moves.
It is a freshness checksum, not an authorization credential. Existing paired
merge logic runs in the same outer transaction; any later failure rolls back
all preceding pairs. Each source retains its own immutable operation and audit.
Choices are applied inside the final pair before its after-snapshot is recorded.
The old `merge(targetId, sourceClientId, actor)` signature and endpoint payload
remain unchanged; legacy callers do not need preview tokens.

Batch provenance additionally records immutable batch ID, source order and pair
index. Sibling splits must run in reverse order. Each successful target restore
appends a version-continuation receipt to its SPLIT audit. An earlier pair can
bridge its version only when the next sibling's receipt matches the exact
current row version, expected predecessor version and every saved target field.
An intervening operator edit (including away-and-back) breaks the receipt chain.
This avoids resetting updatedAt to an old value and avoids editing immutable
merge snapshots. Batch AI consolidation does not rewrite unchanged modes, so
its own no-op does not masquerade as a later operator edit during separation.

New error codes: CLIENT_MERGE_SELECTION_INVALID,
CLIENT_MERGE_FIELD_CHOICES_INVALID, CLIENT_MERGE_PREVIEW_TOKEN_INVALID,
CLIENT_MERGE_PREVIEW_STALE, CLIENT_MERGE_IDENTITY_CONFLICT,
CLIENT_MERGE_SCHEMA_NOT_READY. Existing merge errors
are retained. Stale approval uses HTTP 409; invalid/blocked selection uses 400.

## Files and separation

New provenance adds an optional `files` array to format 1. Missing means no
recorded files, preserving historical operation compatibility. Every recorded
file is moved/restored by exact ID and current owner with a checked row count.
Later files stay canonical after split; they have no historical source evidence.
The additive migration installs a ClientFile global-lock trigger before the
existing owner-routing trigger. A late upload that validated the old source is
routed to the canonical client; acquiring global before Client FOR SHARE avoids
inverting merge and upload Activity lock order. File IDs, paths and bytes are
never copied or regenerated.
The window is a BEFORE STATEMENT trigger, before update/delete row locks can be
held. The ClientFile statement window is SHARED; merge/split take EXCLUSIVE.
Message, Payment and Measurement receive no new trigger: their existing parent
foreign keys remain unchanged. Their preview counts are informational. Payment
add/void acquire the shared merge window before their existing order advisory
lock. A catalog guard fails closed before merge/split if the required ClientFile
triggers are absent, disabled or point at incompatible functions. Complete
function-body fingerprints use a closed approved allowlist; statement-presence
regexes cannot establish executable protection. The additive
migration must be installed before merge/split can be used.

Split retains the existing bounded semantics: dependency conflicts block it,
chains unwind in reverse ancestry order, subsequent target edits are preserved,
legacy operations without provenance only support evidenced channel separation.
Batch is not a promise of arbitrary full undo. Parent owns canonical read/link
resolution; legacy detail behavior is unchanged by this patch.

## Profile and notes

`updateProfile` additionally accepts nullable preferredChannel and
responsibleManagerId. An explicitly selected non-null manager must be active
and unarchived. Existing profile CAS and audit include both fields.
Creation normalizes present email by trim/lowercase and phone to digits with an
optional leading `+`; empty contacts are omitted. Profile edits use the same
normalization, with explicit empty values clearing to null. Country codes are
never inferred. Other create fields keep their existing names. Before a legacy
Facebook synthetic email or WhatsApp phone is replaced, an otherwise missing
provider identity is retained in facebook/whatsapp and included in profile audit.

`updateNotes(id, notes, actor, options?)` accepts optional visibility
INTERNAL/CLIENT and expectedUpdatedAt. Visibility defaults to INTERNAL, including
the legacy three-argument call; only preferences.clientNoteVisibility changes,
preserving other preferences. Row/global locks protect the optional CAS.
This label does not publish or send notes and grants no public read access.
Combined merge notes are INTERNAL. New snapshots have optional
clientNoteVisibility; historical snapshots without it stay valid. Split restores
recorded visibility subject to the existing target-version check, preserving
unrelated preferences and subsequent target edits.

## Verification and remaining integration gates

Failing-first evidence: missing public preview method; missing file restoration;
ignored notes visibility/options; ignored profile extensions; DTO accepting null
choices; missing executable routing migration. Focused tests exercise service
behavior through a transactional Prisma-boundary model and SQL through PGlite.
PGlite verifies real routing/ownership SQL, not multi-connection lock races.
Parent must run native PostgreSQL upload-vs-merge/split races and the final
integrated route/RBAC/UI tests. Worker reviewers and quality results are reported
in the delivery message. No installed/live acceptance is claimed.

Delivery checks: `node --test apps/api/tests/client*.test.mjs` reports 125 PASS,
0 FAIL, 1 explicit SKIP (the dedicated native PostgreSQL suite). PGlite executes
the actual migration, stale-file routing, exact split ownership and statement
the ClientFile statement window. Native race runner:
`CLIENT_MERGE_TEST_DATABASE_URL` must point to the explicitly named loopback
`clients_merge_test` DB with no URL options; it creates/drops only its own random
schema. The integrator configured a temporary native PostgreSQL cluster only on
127.0.0.1:55575 for these synthetic tests. API typecheck and whitespace checks
are reported at delivery. Parent requested immediate integration and owns final
independent reviews and the full integrated quality gate. Preliminary worker
reviews found the sibling split/version and nested-writer windows issues; both
were fixed with focused regression coverage. Those preliminary verdicts are
not final reviews of the delivered patch. Controller/main DTO/module and root
CHAT_HANDOFF.md remain parent-owned and untouched.

Final direct API typecheck and git diff --check PASS. The worker full quality
attempt completed tests and all workspace typechecks, then failed at Next.js
build because Turbopack rejects apps/web/node_modules pointing outside the
worker filesystem root. This is not a full quality PASS; parent must run the
integrated gate with its own dependency layout. Log:
`.local/client-merge-quality-final.log`. Final focused log:
`.local/client-merge-delivery-focused.log`.

Final integration handoff: version, lockfile and next-env.d.ts are unchanged;
no generated build files belong to the patch. Parent owns the final integrated
build using its own offline dependency installation. No dependency repair or
repeat full quality was attempted after the final handoff instruction.
Cleanup of ignored worker apps/api/dist, apps/web/.next and
apps/web/tsconfig.tsbuildinfo was rejected by automatic tool policy
(`blocked by policy`); these local artifacts remain excluded from the patch.
