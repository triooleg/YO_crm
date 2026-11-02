import type { Prisma } from '@prisma/client';
import type { FinancePaymentFacts } from './finance-report-model';

/** Lifetime values stay in the order currency. No current FX is used to infer
 * missing historical applied amounts. Only aggregates and one latest receipt
 * timestamp candidates per order cross the boundary, never lifetime history.
 * Ties use the report's JS collation, which need not match PostgreSQL collation. */
export async function readFinancePaymentFacts(tx: Prisma.TransactionClient): Promise<FinancePaymentFacts> {
  const rows = await tx.$queryRawUnsafe<{orderId: string; paid: string | null; invalid: boolean; latest: NonNullable<FinancePaymentFacts[string]['latest']>[]}[]>(`
    SELECT o.id AS "orderId", COALESCE(p.paid,0)::text AS paid,
      COALESCE(p.invalid,false) AS invalid, l.latest
    FROM "Order" o
    LEFT JOIN LATERAL (
      SELECT SUM(CASE WHEN p.currency=o.currency THEN p."amountMinor"
        WHEN p."appliedCurrency"=o.currency AND p."appliedAmountMinor">=0 THEN p."appliedAmountMinor" ELSE 0 END)::bigint AS paid,
        bool_or(p.currency<>o.currency AND (p."appliedCurrency" IS DISTINCT FROM o.currency OR p."appliedAmountMinor" IS NULL OR p."appliedAmountMinor"<0)) AS invalid
      FROM "Payment" p WHERE p."orderId"=o.id AND p."voidedAt" IS NULL
    ) p ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(jsonb_build_object('id',p.id,'orderId',p."orderId",'amountMinor',p."amountMinor",'currency',p.currency,
        'receivedAt',to_char(p."receivedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'method',p.method,'notes',p.notes) ORDER BY p.id ASC) AS latest
      FROM "Payment" p WHERE p."orderId"=o.id AND p."voidedAt" IS NULL
        AND p."receivedAt"=(SELECT max(recent."receivedAt") FROM "Payment" recent WHERE recent."orderId"=o.id AND recent."voidedAt" IS NULL)
    ) l ON true WHERE o."archivedAt" IS NULL`);
  return Object.fromEntries(rows.map(row => {
    const candidate = row.paid === null || row.invalid ? null : Number(row.paid);
    // The report model validates eligible debt/payment cohorts. Do not reject
    // an otherwise unrelated fully closed order merely while reading facts.
    const paid=candidate===null||!Number.isSafeInteger(candidate)||candidate<0?null:candidate;
    const latest=[...(row.latest??[])].sort((a,b)=>b.id.localeCompare(a.id))[0]??null;
    return [row.orderId,{paidMinor:paid,latest}];
  }));
}
