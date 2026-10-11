export const SORTABLE_ORDER_COLUMNS = ["client", "quantity", "discipline", "designs", "deadline", "payment", "status", "nextAction", "delivery", "created"];

const defaultDirections = {
  client: "asc",
  quantity: "desc",
  discipline: "asc",
  designs: "asc",
  deadline: "asc",
  payment: "desc",
  status: "asc",
  nextAction: "asc",
  delivery: "asc",
  created: "desc",
};

const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

export function defaultOrderSort(column) {
  return { column, direction: defaultDirections[column] ?? "asc" };
}

export function nextOrderSort(current, column) {
  if (current.column !== column) return defaultOrderSort(column);
  return { column, direction: current.direction === "asc" ? "desc" : "asc" };
}

function paid(order) {
  return (order.payments ?? []).filter((payment) => !payment.voidedAt).reduce((sum, payment) => {
    if (payment.appliedCurrency === order.currency && payment.appliedAmountMinor != null) return sum + payment.appliedAmountMinor;
    if (payment.currency === order.currency) return sum + (payment.amountMinor ?? 0);
    return sum;
  }, 0);
}

function value(order, column) {
  if (column === "client") return order.client?.displayName ?? "";
  if (column === "quantity") return (order.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
  if (column === "discipline") return order.discipline ?? "";
  if (column === "designs") return order.items?.[0]?.name ?? order.notes ?? "";
  if (column === "deadline") return order.requiredDeliveryAt ? Date.parse(order.requiredDeliveryAt) : null;
  if (column === "payment") return Math.max(0, (order.priceMinor ?? 0) - paid(order));
  if (column === "status") return order.salesStatus ?? "";
  if (column === "nextAction") return `${order.productionStatus ?? ""}|${order.salesStatus ?? ""}`;
  if (column === "delivery") return `${order.client?.country ?? order.country ?? ""}|${order.deliveryCity ?? ""}|${order.deliveryAddressText ?? ""}`;
  if (column === "created") return order.createdAt ? Date.parse(order.createdAt) : null;
  return "";
}

function compareValues(left, right, direction) {
  const leftMissing = left === null || left === undefined || left === "";
  const rightMissing = right === null || right === undefined || right === "";
  if (leftMissing) return rightMissing ? 0 : 1;
  if (rightMissing) return -1;
  const result = typeof left === "number" && typeof right === "number" ? left - right : collator.compare(String(left), String(right));
  return direction === "asc" ? result : -result;
}

/**
 * @param {Array<any>} orders
 * @param {{ column: string, direction: "asc" | "desc" }} sort
 * @param {(order: any, column: string) => unknown} [projection]
 */
export function sortOrders(orders, sort, projection) {
  return [...orders].sort((left, right) => compareValues(projection?.(left, sort.column) ?? value(left, sort.column), projection?.(right, sort.column) ?? value(right, sort.column), sort.direction) || collator.compare(left.number ?? left.id ?? "", right.number ?? right.id ?? ""));
}
