import { orderSettlement } from "./order-settlement.mjs";
export const SORTABLE_ORDER_COLUMNS = [
  "source",
  "client",
  "model",
  "quantity",
  "deadline",
  "payment",
  "production",
  "delivery",
  "status",
  "created",
  // Kept for saved settings and consumers that still use the previous table model.
  "discipline",
  "designs",
  "nextAction",
];

const defaultDirections = {
  source: "asc",
  client: "asc",
  model: "asc",
  quantity: "desc",
  discipline: "asc",
  designs: "asc",
  deadline: "asc",
  payment: "desc",
  production: "asc",
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

function value(order, column) {
  if (column === "source") return order.orderSource ?? "UNKNOWN";
  if (column === "client") return order.client?.displayName ?? "";
  if (column === "model") return `${order.items?.[0]?.name ?? order.notes ?? ""}|${order.discipline ?? ""}`;
  if (column === "quantity") return (order.items ?? []).reduce((sum, item) => sum + (item.quantity ?? 0), 0);
  if (column === "discipline") return order.discipline ?? "";
  if (column === "designs") return order.items?.[0]?.name ?? order.notes ?? "";
  if (column === "deadline") return order.requiredDeliveryAt ? Date.parse(order.requiredDeliveryAt) : null;
  if (column === "payment") return orderSettlement(order).balanceMinor;
  if (column === "production") return order.productionSlot?.startsAt ? `${order.productionSlot.startsAt}|${order.productionStatus ?? ""}` : null;
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
