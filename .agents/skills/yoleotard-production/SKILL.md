---
name: yoleotard-production
description: Work with YO_crm production statuses, slots, schedules, deadlines and deposit gates. Use for production planning, queue, calendar, readiness or production-related order transitions.
---

# Yoleotard production

Read `CONTEXT.md`, the `ProductionStatus` and `ProductionSlot` schema, and
`apps/api/src/orders/production-rules.ts` plus `orders.service.ts`.

1. Derive the workflow from current enums and services; prose examples are not
   a status source of truth.
2. Preserve the distinction between order sales status, item/order production
   status, payment status and shipping status.
3. Keep a production slot tentative until payments in the order currency reach
   `depositRequiredMinor`.
4. Use configured duration to seed a new order's initial slot. Manual slot
   updates currently enforce start/end ordering and shipping lead, but do not
   force that default duration; changing this requires an approved rule and test.
5. Preserve advisory-lock and audit/activity patterns when updating deadlines,
   slots or status gates.
6. Treat the production schedule as a view over slots, not as a separate source
   of truth.
7. Cover changed gates and date boundaries with deterministic tests before UI
   work; run production and order tests together.
