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

export function migrateLegacyOrderColumnSettings(raw, defaultColumns) {
  if (!raw) return undefined;
  try {
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return undefined;
    if (saved.order !== undefined && !Array.isArray(saved.order)) return undefined;
    if (saved.hidden !== undefined && !Array.isArray(saved.hidden)) return undefined;
    const legacyOrder = Array.isArray(saved.order) ? saved.order : [];
    const legacyHidden = new Set(Array.isArray(saved.hidden) ? saved.hidden : []);
    const map = (id) => id === "designs" || id === "discipline" ? "model" : id === "nextAction" ? "production" : id;
    const order = [];
    for (const legacyId of legacyOrder) {
      const id = map(legacyId);
      if (defaultColumns.includes(id) && !order.includes(id)) order.push(id);
    }
    const hidden = defaultColumns.filter((id) => {
      if (id === "model") return legacyHidden.has("designs") && legacyHidden.has("discipline");
      if (id === "production") return legacyHidden.has("nextAction") || legacyHidden.has("production");
      return legacyHidden.has(id);
    });
    return { order: [...order, ...defaultColumns.filter((id) => !order.includes(id))], hidden };
  } catch {
    return undefined;
  }
}
