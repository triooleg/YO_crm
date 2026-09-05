export type InboxMeasurement = {
  id: string;
  measuredAt: string;
  unit?: string;
  height?: string | number | null;
  chest?: string | number | null;
  waist?: string | number | null;
  hips?: string | number | null;
  torso?: string | number | null;
  values?: { standardHeight?: string | number | null } | null;
};

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
