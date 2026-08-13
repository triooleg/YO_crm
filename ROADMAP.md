# Yoleotard CRM roadmap

## Phase 0 - Infrastructure discovery (complete; audit gap closed locally)

Docker/Portainer/Nginx Proxy Manager topology, occupied ports, deployment access
and reusable patterns documented. Executable database/upload backup and restore
scripts now match the operations guide; a production restore drill is still a
release operation, not claimed here.

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

## Phase 4 - Production (complete; audit warning closed locally)

Calendar, capacity, slots, deadlines, tasks and readiness/deposit gates. Receipt
of the required deposit automatically confirms an existing tentative slot.

## Phase 5 - Finance (complete; audit gaps closed locally)

Invoices with generated PDF binaries, payment allocation, multi-currency
balances and audit.

## Phase 6 - Shipping (complete; audit gap closed locally)

Shipments, carriers, tracking, delivery states and overdue alerts. Shipping
state changes are owned by the shipment flow and cannot be bypassed through the
generic order-status route.

## Phase 7 - Communications (in progress)

Internal drafts, message references, templates, channel settings and timeline.
External Chatwoot/e-mail ingestion and delivery remain pending credentials and
integration work.

## Phase 8 - Automation and AI

Reminders, rules, multilingual drafts, translation and summaries.

## Phase 9 - Analytics and polish

Dashboards, reports, advanced search, performance, accessibility and UX.
