# Editing invoice templates

In Settings -> Invoice templates, use Edit template for any existing template,
including the built-in SEPA, SWIFT and customer-card definitions. The same editor
supports requisites, language, currency, field selection, appearance and structured
JSON configuration. Validate and preview against an order before saving.

The first save of a built-in definition persists its customization under the same
key in the existing DocumentTemplate table. There is one effective choice, not a
second template. Later saves use revision checks; simultaneous stale saves refuse
rather than overwrite another administrator's changes. Duplicate remains available
when a separate template is wanted. Existing document kinds stay immutable.

Untouched built-in invoice seller details inherit the existing finance settings.
After customization, the saved values take precedence; clearing a required detail
requires completing it before generating an invoice. Customer cards need no invoice
seller details. New invoice generation still checks required fields and uses the
unchanged authoritative order total and tax treatment.

Inactive or archived customizations never fall back to the original built-in choice.
Previously saved invoices, PDFs and generic documents retain their snapshots and
artifacts. Already generated previews retain their content when a template is edited;
new persistence still checks the effective template's current active state.

No schema migration is needed. Existing OWNER/ADMIN mutation guards and audit
transactions are reused. This change is local and has not been deployed.
