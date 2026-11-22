import type { FinanceReport } from "./finance-report";

type RatesStatus = {
  provider?: string;
  cache?: { effectiveDate?: string; fetchedAt?: string } | null;
};

export type FinanceRateRefresh = { rates: RatesStatus; warning?: never } | { rates?: never; warning: string };

export function refreshFinanceRates(
  request: (path: string, init: RequestInit) => Promise<RatesStatus>,
): Promise<FinanceRateRefresh> {
  return request("/finance/exchange-rates/ensure-current", { method: "POST" }).then(
    rates => ({ rates }),
    reason => ({ warning: reason instanceof Error ? reason.message : String(reason) }),
  );
}

export function reportRatesChanged(report: FinanceReport, rates?: RatesStatus) {
  return Boolean(rates?.cache?.fetchedAt && (
    rates.provider !== report.valuation?.provider ||
    rates.cache.effectiveDate !== report.valuation?.effectiveDate ||
    rates.cache.fetchedAt !== report.valuation?.fetchedAt
  ));
}
