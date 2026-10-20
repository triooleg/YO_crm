---
status: accepted
---

# Convert an order currency only from a recorded official rate

YO_crm supports EUR, USD and UAH. An administrator selects one official rate
provider and explicitly refreshes a server-side cache. NBU supplies EUR/UAH and
USD/UAH observations and therefore one internally consistent matrix for all
three currencies. ECB supplies only EUR/USD; a conversion involving UAH is
rejected while ECB is selected. The application never silently mixes providers
or substitutes a commercial market rate.

Each observation retains its official URL, effective date, fetch time and exact
decimal value. Decimal rates are parsed into a reduced integer rational and all
minor-unit amounts are converted with BigInt arithmetic and round-half-up. No
financial conversion uses binary floating point.

Both refresh and conversion reject an observation whose effective date is more
than seven calendar days old. This bounded tolerance covers ordinary weekends
and official holiday gaps without allowing a newly fetched but historically
stale observation to become valid.

NBU may publish the official rate for the next calendar day during the
preceding day. YO_crm accepts that one-day-ahead NBU observation, but rejects a
later future date. ECB observations remain limited to the current or an earlier
calendar day.

When an operator records a payment in a currency different from the order
currency, YO_crm automatically reuses a fresh cache or refreshes the selected
official source before the write. The payment keeps the received amount and
currency unchanged. A separate applied amount in the order currency and an
immutable exchange-rate snapshot preserve the exact provider, official URL,
effective date, fetch time, rational rate and source observations used for the
calculation. Order balance, deposit gates, production-slot confirmation and
invoice payment checks use that applied amount. A same-currency payment does
not need or store a conversion.

Changing an order currency is an explicit, audited transaction. It locks the
order and converts every monetary field on the order and its items together.
The activity and audit records retain the exact numerator, denominator,
provider, official URL, source observations (including their decimal,
numerator, denominator and series identifier) and dates. Provider selection,
cache refresh and order conversion share one transaction-scoped advisory lock,
so a conversion cannot commit against a provider that changed concurrently.
The operation fails closed when the
cache is missing, stale, from another selected provider or does not support the
pair.

An order with any payment history, any invoice, a monetary shipment cost or
KeyCRM ownership cannot be converted. Those records already form economic or
provider history and must not be rewritten. The operator must correct such a
currency at its source or create an explicit compensating business operation.

The provider endpoint is fixed in server code and needs no credential. Rate
settings and refresh are OWNER/ADMIN operations; managers may read the selected
source and change the currency of an otherwise eligible order.
