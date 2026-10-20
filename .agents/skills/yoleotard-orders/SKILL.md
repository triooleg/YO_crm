---
name: yoleotard-orders
description: Work safely with YO_crm orders, order items, independent statuses, deadlines and related client, athlete, measurement, payment, production and shipment records. Use for order API, UI, schema, tests or business rules.
---

# Yoleotard orders

Read `CONTEXT.md`, `PROJECT_BLUEPRINT.md`, `docs/DATABASE.md`, the `Order` and
`OrderItem` models in `packages/database/prisma/schema.prisma`, and the owning
code under `apps/api/src/orders/` before changing behaviour.

1. Trace the complete path: DTO → controller → service/transaction → Prisma →
   frontend consumer → tests.
2. Preserve `Order.number` as the user-visible unique identifier and verify
   client, athlete and measurement ownership inside the API.
3. Keep sales, production, payment and shipping statuses independent. Change a
   derived dimension only in its owning flow.
4. Keep money in integer minor units with the order ISO currency. Derive paid,
   deposit and balance values from persisted payments and order totals.
5. For pair/group/multi-item orders, preserve each item's athlete and immutable
   measurement reference.
6. Record important changes in `Activity` and `AuditLog`; preserve archive and
   history conventions.
7. Add a failing business-level test for risky rules, then run affected tests,
   typecheck and build before completion.

Use `apps/web/components/orders-dashboard.tsx` and its focused tests for the
current order UI. There is no standalone Design entity; do not introduce one as
an incidental refactor.
