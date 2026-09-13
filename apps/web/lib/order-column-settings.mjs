export function parseOrderColumnSettings(raw, defaultColumns) {
  if (!raw) return undefined;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return undefined;
    if (saved.order !== undefined && !Array.isArray(saved.order)) return undefined;
    if (saved.hidden !== undefined && !Array.isArray(saved.hidden)) return undefined;

    const knownOrder = [];
    for (const id of saved.order ?? []) {
      if (defaultColumns.includes(id) && !knownOrder.includes(id)) knownOrder.push(id);
    }
    const hidden = [];
    for (const id of saved.hidden ?? []) {
      if (defaultColumns.includes(id) && !hidden.includes(id)) hidden.push(id);
    }
    return {
      order: [...knownOrder, ...defaultColumns.filter((id) => !knownOrder.includes(id))],
      hidden,
    };
  } catch {
    return undefined;
  }
}
