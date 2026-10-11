# Yoleotard CRM roadmap

## Phase 0 - Infrastructure and recovery foundation (implemented locally)

Docker/Portainer/Nginx Proxy Manager topology, occupied ports, deployment access
and reusable patterns are documented. PostgreSQL, uploads and backup artifacts
have explicit persistent storage. Migration-managed backup metadata, local
storage abstraction, DATA/FULL manifest format, checksums, guarded CLI and a real
isolated v2 plus legacy-v1 restore drill are implemented. Automated scheduling,
audited retention deletion, off-server S3 storage and production recovery remain
explicit later release work.

## Phase 1 - Foundation (complete; auth UX follow-up deferred)

Monorepo, database, API auth/RBAC, responsive layout, Docker, dependency-aware
health checks and docs. Broad CRM reads are restricted to CRM roles and
production uses a least-privilege order projection. A global web authentication
lifecycle and role-aware navigation are explicitly deferred for focused testing.

## Phase 2 - Clients (complete; audit gap closed locally)

Clients, athletes, measurements, tags, notes, search and activity timeline.
Order creation now validates client/athlete/measurement ownership transactionally.

## Phase 3 - Orders (complete; audit gaps closed locally)

Order types, pipeline, ready models, designs, files, prices and deposits. The
configured deposit percentage supplies the server-side default, with an explicit
authorized override path.

The additive KeyCRM order-import foundation is implemented locally: encrypted
connection settings, connection test, dry-run/apply gate, resumable server-side
history, scoped provider identities and per-order issues. Production migration,
configuration and the first reviewed import remain a separate release action.

## Phase 4 - Production (complete and deployed)

Calendar, capacity, slots, deadlines, tasks and readiness/deposit gates. Receipt
of the required deposit automatically confirms an existing tentative slot.
Server-owned production duration and shipping-reserve settings, automatic
tentative scheduling and their controlled production UAT are complete.

## Phase 5 - Finance (complete; audit gaps closed locally)

Invoices with generated PDF binaries, payment allocation, multi-currency
balances and audit.

## Phase 6 - Shipping (complete; audit gap closed locally)

Shipments, carriers, tracking, delivery states and overdue alerts. Shipping
state changes are owned by the shipment flow and cannot be bypassed through the
generic order-status route.

## Phase 7 - Communications (operational; provider smoke follow-ups remain)

The unified inbox has bidirectional Facebook, Instagram, WhatsApp, Chatwoot and
Gmail flows, scoped identities, attachments, replies, reactions, read receipts,
audited delivery attempts and duplicate-send protection. Channel, order-history
and active-order filters are implemented. Real provider-side smoke evidence is
tracked separately whenever it requires a controlled customer/test action.

## Phase 7.5 - Tasks Kanban (complete and deployed)

Customizable Kanban with compact C and visual B views, client/incoming and
administrative tasks, assignees, deadlines, markers, labels, persistent images,
audited movement and soft archive. Production migration and live smoke are
complete.

## Phase 8 - Automation and AI

Reminders, rules, multilingual drafts, translation and summaries.

## Phase 9 - Analytics and polish

Dashboards, reports, advanced search, performance, accessibility and UX.
