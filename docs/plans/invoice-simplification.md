# Invoice simplification — 2026-10-26

Source: owner-supplied `YO_CRM_Invoice_Codex_Package.zip`. The specification and
approved PNG inside the ZIP match the separately supplied files byte for byte
(SHA-256 specification `3bac92424f2f91ca23a7cc7f72ad348e7feefefa2ab24a20d25e6a9d4d2615a0`,
PNG `0c16bba7c56757002ca2b120d8b2f56a54a271acbb6bba7990060ca13912e21b`).

## Accepted scope

Two actions from Orders Finance to preview: open invoice creation, select an
active invoice template. Preview displays the actual server-generated A4 PDF
and offers explicit save, download, print and return to templates. Downloads
and print do not save an Invoice. Saved documents remain accessible from both
the order and Finance. General non-invoice creation retains its existing entry
point under the document card's additional-actions menu.

Reuse Invoice, DocumentTemplate, existing structured JSON snapshots, PDFKit,
RBAC and audit. The template code editor edits the existing declarative JSON
format, not executable HTML or JavaScript. No new external rendering service,
network-capable template interpreter or invoice engine is introduced.

The server owns the order snapshot, final amount, currency and invoice number.
The accepted order price is authoritative; taxes already included in that price
are disclosure only. Invoice lifecycle is separate from order/payment status.
New saved documents retain immutable PDF bytes and template/order snapshots;
legacy invoice creation, editing and rendering remain available for historical
documents. Copies are separate documents with explicit lineage.

## Verification boundaries

- Invoice preview/save/read API: snapshot authority, concurrency, idempotency,
  retention, actor scope, RBAC, template currency and required data errors.
- Existing finance APIs: no change to payment totals, allocation, statuses or
  legacy invoice/document compatibility.
- Browser Orders Finance: template selection, preview-only actions, save,
  retry, saved read/download/copy/archive, desktop and mobile.
- Template settings: JSON validation/highlighting, metadata, defaults,
  active/archive, duplicate, selected-order PDF preview.
- Real renderer: A4, Unicode, multi-item and multipage documents, visual output.

No production deployment, migration, data backfill, commit or push is part of
this request. A later release must run affected authorized live smoke paths.
