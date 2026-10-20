---
name: yoleotard-payments
description: Work with YO_crm deposits, payments, balances, invoices and currencies. Use for finance or order-payment behavior, calculations, status changes, invoice data or payment audit.
---

# Yoleotard payments

Read `CONTEXT.md`, `docs/DATABASE.md`, Payment/Invoice/Order schema models, and
the owning services under `apps/api/src/orders/` and `apps/api/src/finance/`.

1. Represent money as integer minor units plus ISO currency; never introduce
   floating-point persistence or mixed-currency summation.
2. Treat deposit and balance as calculated concepts. The required deposit lives
   on the order; received amounts live as immutable Payment records.
3. Accept a payment only in the order currency and derive payment status from
   the persisted total using the current service rules.
4. Keep invoice status separate from payment status and preserve invoice
   customer/seller/item snapshots.
5. Confirm tentative production only through the existing deposit gate and
   transaction, with Activity and AuditLog evidence.
6. Do not invent a refund ledger: `REFUNDED` exists as a status, while no
   standalone refund transaction model currently exists.
7. Never place provider secrets, bank credentials, tokens or customer financial
   data in skills, fixtures, docs or logs. Use synthetic values in tests.
