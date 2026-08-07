# Database conventions

- CUID primary keys and createdAt/updatedAt timestamps.
- Business entities use nullable archivedAt where history must remain.
- Money uses integer minor units and a three-letter currency.
- Measurements are dated snapshots and never overwritten.
- Orders reference client, athlete and optional measurement snapshot.
- Sales, production, payment and shipping status remain separate.
- Production uses committed Prisma migrations and `prisma migrate deploy`.
