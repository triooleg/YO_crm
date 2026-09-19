export function withPreferredItem<T extends { id: string }>(items: T[], preferredItem?: T | null) {
  if (!preferredItem || items.some((item) => item.id === preferredItem.id)) {
    return { items, aggregateItems: items, preferredId: undefined };
  }
  return { items, aggregateItems: [preferredItem, ...items], preferredId: preferredItem.id };
}
