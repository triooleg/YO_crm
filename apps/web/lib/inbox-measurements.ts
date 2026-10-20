export type InboxMeasurement = {
  id: string;
  measuredAt: string;
  definitionVersion?: string | null;
  unit?: string;
  height?: string | number | null;
  chest?: string | number | null;
  waist?: string | number | null;
  hips?: string | number | null;
  torso?: string | number | null;
  values?: Record<string, string | number | null> | null;
};

export function editableInboxMeasurementValues(snapshot?: InboxMeasurement) {
  if (!snapshot) return {};
  const editable: Record<string, number> = {};
  for (const key of ["standardHeight", ...Array.from({ length: 17 }, (_, index) => `m${index + 1}`)]) {
    const value = snapshot.values?.[key];
    const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    if (Number.isFinite(numeric)) editable[key] = numeric;
  }
  const legacyFields = { m1: snapshot.chest, m2: snapshot.waist, m3: snapshot.hips, m15: snapshot.torso } as const;
  for (const [key, value] of Object.entries(legacyFields)) {
    if (editable[key] != null) continue;
    const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
    if (Number.isFinite(numeric)) editable[key] = numeric;
  }
  return editable;
}

export function inboxMeasurements(snapshot?: InboxMeasurement) {
  if (!snapshot) return [];
  const fields = ["height", "chest", "waist", "hips", "torso"] as const;
  const values: { field: typeof fields[number] | "standardHeight"; value: string | number; unit: string }[] = [];
  if (snapshot.height == null && snapshot.values?.standardHeight != null) {
    values.push({ field: "standardHeight", value: snapshot.values.standardHeight, unit: snapshot.unit || "cm" });
  }
  for (const field of fields) {
    const value = snapshot[field];
    if (value != null) values.push({ field, value, unit: snapshot.unit || "cm" });
  }
  return values;
}
