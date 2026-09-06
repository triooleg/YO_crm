---
name: yoleotard-measurements
description: Work with YO_crm athlete measurement snapshots, the 17-field form, validation and order references. Use for measurement storage, forms, validation, viewing or order measurement replacement.
---

# Yoleotard measurements

Read the Measurement section in `CONTEXT.md`, `CreateMeasurementDto` in
`apps/api/src/clients/clients.dto.ts`, the client/order services, and
`apps/web/components/measurement-panel.tsx` before editing.

1. Treat every measurement as an immutable dated snapshot owned by one athlete.
2. Keep `m1..m17` in JSON `values`; mirror `m1`, `m2`, `m3`, `m15` into chest,
   waist, hips and torso as the current services do.
3. Preserve current validation: required `m1`, `m2`, `m3`, `m15`; minimum 1;
   increments of 0.5 cm; supported `standardHeight` values come from the DTO and
   form.
4. Use the 17 canonical Russian labels from `measurement-panel.tsx`; do not
   rename or reorder fields in only one layer.
5. Replacing order measurements creates a new snapshot and atomically updates
   order/item references with the existing optimistic conflict check.
6. Add no conversion, range, sizing or body formula unless current business
   logic or an approved specification defines it.
7. Verify DTO, service, form/viewer and focused tests together.
