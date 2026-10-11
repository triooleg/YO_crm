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
