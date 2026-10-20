---
status: resolved
trigger: "Chatwoot messages arrive in CRM, but photos do not; make the channel end-to-end so inbound and outbound messages are both visible like Instagram and Facebook."
created: 2026-08-31
updated: 2026-08-31
---

## Symptoms

- expected: Incoming Chatwoot photos, videos and files render in CRM; both incoming and outgoing Chatwoot messages form one idempotent conversation history.
- actual: Text messages arrive, while a real image message is stored only as `[Фото]`; outgoing Chatwoot webhook events are ignored.
- errors: No user-visible error. Production evidence for `chatwoot:2:1837` shows one attachment type, zero attachment metadata objects and zero stored MessageAttachment rows.
- timeline: Present in the first verified production Chatwoot integration on 2026-08-31.
- reproduction: Send an image or an outgoing reply through Chatwoot inbox 2 and inspect the corresponding CRM conversation.

## Current Focus

- hypothesis: `normalizeChatwootWebhook` drops attachment objects and rejects every outgoing `message_created` event.
- test: Add contract tests for safe attachment normalization and outbound echo normalization/idempotency.
- expecting: Tests fail before implementation because metadata lacks attachments and outgoing payloads normalize to an empty list.
- next_action: inspect current Chatwoot send/persist contracts and add failing tests
- reasoning_checkpoint: Production Chatwoot message 1837 has one image attachment; CRM stored only attachmentTypes and no MessageAttachment.
- tdd_checkpoint: failing-first confirmed; two new normalization tests failed before implementation and passed after the fix

## Evidence

- timestamp: 2026-08-31T09:26:36Z
  observation: Chatwoot message 1837 contains one image attachment.
- timestamp: 2026-08-31T09:26:36Z
  observation: CRM message chatwoot:2:1837 contains `[Фото]`, one attachment type, zero attachment objects, and zero MessageAttachment rows.
- timestamp: 2026-08-31
  observation: Normalizer maps only attachmentTypes and returns early unless message_type is incoming.

## Eliminated

- hypothesis: Chatwoot does not send the photo.
  reason: The production Chatwoot database records attachment_count=1 for message 1837.
- hypothesis: Webhook transport or authentication drops the request.
  reason: The corresponding CRM message and webhook envelope exist.

## Resolution

- root_cause: Chatwoot normalization retained only attachment type names and rejected all outgoing webhook messages; the CRM send path supported only Meta channels.
- fix: Preserve bounded HTTPS attachment metadata, persist incoming and outgoing Chatwoot history idempotently, add audited provider echo merging, implement Chatwoot text/file delivery with durable attempts, and enable the existing composer/emoji UI for Chatwoot.
- verification: Targeted Chatwoot/API tests 48/48, web communications tests 45/45, full quality gate (API 255/255, database 7/7, complete web suite, typechecks and builds), exact-origin and multipart behavior tests, and real-browser visual checks at 1920x1080, 1366x768 and 390x844.
- files_changed: apps/api/src/communications/chatwoot-delivery.ts, chatwoot-webhook.ts, communications.service.ts; API tests; communications workspace CSS/TSX/i18n and tests.
