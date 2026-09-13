export function parseOrderColumnSettings<T extends string>(
  raw: string | null,
  defaultColumns: readonly T[],
): { order: T[]; hidden: T[] } | undefined;
