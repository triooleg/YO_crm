export const locales = ['ru', 'en', 'fr', 'de', 'es', 'it'] as const;
export type Locale = typeof locales[number];
export type Units = 'cm' | 'in';
export type MeasurementKey = `m${number}`;
export const requiredMeasurements = [1, 2, 3, 15] as const;
export const additionalMeasurements = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17];
export const disciplines = ['RHYTHMIC_GYMNASTICS', 'ACROBATIC_GYMNASTICS', 'FIGURE_SKATING', 'AEROBIC_GYMNASTICS', 'BATON_TWIRLING_MAJORETTE', 'OTHER'] as const;
export type Draft = {
  firstName: string; lastName?: string; age?: number; heightCm?: number;
  discipline?: string; measuredAt?: string; values?: Partial<Record<MeasurementKey, number>>;
  notes?: string; warningsAcknowledged?: string[]; locale?: Locale; units?: Units; rangeVersion?: string;
};
export type Child = { id: string; revision: number; draft: Draft; photoUrl?: string; submitted?: { id: string; measurementId: string; reviewStatus: string } };
export type RangeRule = { id: string; field: number; lowerCm: number; upperCm: number; discipline?: string; minHeightCm?: number; maxHeightCm?: number };
export type RangePolicy = { version: string | null; rules: RangeRule[] };
export type Session = { orderNumber: string; locale: Locale; expiresAt: string; csrfToken: string; children: Child[]; ranges?: RangePolicy };
export type Receipt = { id: string; measurementId: string; reviewStatus: string; assignmentStatus: string };
export type ParseResult = { kind: 'empty' } | { kind: 'invalid' } | { kind: 'valid'; cm: number } | { kind: 'round'; cm: number; enteredCm: number };

export function parseMeasurement(input: string, units: Units): ParseResult {
  const normalized = input.trim().replace(',', '.');
  if (!normalized) return { kind: 'empty' };
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return { kind: 'invalid' };
  const value = Number(normalized);
  const cm = units === 'in' ? value * 2.54 : value;
  if (!Number.isFinite(cm) || cm < 1 || cm > 9999.5 || !Number.isSafeInteger(Math.round(cm * 2))) return { kind: 'invalid' };
  const snapped = Math.round(cm * 2) / 2;
  if (Math.abs(cm - snapped) > 1e-8) return units === 'in' ? { kind: 'round', cm: snapped, enteredCm: cm } : { kind: 'invalid' };
  return { kind: 'valid', cm: snapped };
}

export function displayMeasurement(cm: number | undefined, units: Units, locale: Locale) {
  if (cm === undefined) return '';
  return new Intl.NumberFormat(locale, { maximumFractionDigits: units === 'in' ? 2 : 1, useGrouping: false }).format(units === 'in' ? cm / 2.54 : cm);
}

export function measurementDiagram(locale: Locale): string {
  if (locale === 'en' || locale === 'fr') return `/parent-measurements/reference-${locale}.jpg`;
  return '/parent-measurements/reference-17.png';
}

export function businessDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Kyiv', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function validateDraft(draft: Draft, today = businessDate()): string[] {
  const errors: string[] = [];
  if (!draft.firstName.trim()) errors.push('firstName');
  if (!disciplines.includes(draft.discipline as typeof disciplines[number])) errors.push('discipline');
  const date = draft.measuredAt ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date > today) errors.push('measuredAt');
  for (let n = 1; n <= 17; n++) {
    const value = draft.values?.[`m${n}`];
    if (value === undefined) { if ((requiredMeasurements as readonly number[]).includes(n)) errors.push(`m${n}`); }
    else if (!Number.isFinite(value) || value < 1 || value > 9999.5 || !Number.isSafeInteger(value * 2)) errors.push(`m${n}`);
  }
  if (draft.heightCm !== undefined && (!Number.isFinite(draft.heightCm) || draft.heightCm < 1 || draft.heightCm > 9999.5 || !Number.isSafeInteger(draft.heightCm * 2))) errors.push('heightCm');
  if (draft.age !== undefined && (!Number.isInteger(draft.age) || draft.age < 0 || draft.age > 120)) errors.push('age');
  return errors;
}

export function measurementProgress(draft: Draft) {
  const filled = (n: number) => typeof draft.values?.[`m${n}`] === 'number';
  return { required: requiredMeasurements.filter(filled).length, additional: additionalMeasurements.filter(filled).length };
}

export function detectLocale(languages: readonly string[], linkLocale?: string | null): Locale {
  for (const candidate of [linkLocale, ...languages]) {
    const locale = candidate?.toLowerCase().split('-')[0];
    if (locales.includes(locale as Locale)) return locale as Locale;
  }
  return 'en';
}

// Fragments never travel to the server. Legacy query input is removed immediately by the caller.
export function readEntryLink(href: string): { token: string; recovery: string; locale: string | null } {
  const url = new URL(href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  return { token: fragment.get('invite') ?? fragment.get('token') ?? url.searchParams.get('token') ?? '', recovery: fragment.get('recover') ?? fragment.get('recovery') ?? url.searchParams.get('recover') ?? '', locale: fragment.get('lang') ?? url.searchParams.get('lang') };
}

export function safePublicLink(raw: string, origin: string): string {
  const url = new URL(raw, origin);
  if (url.origin !== origin || url.pathname !== '/parent-measurements' || !['http:', 'https:'].includes(url.protocol)) throw new Error('invalid-link');
  return url.href;
}

/** A navigation window, never a validation rule or a default measurement. */
export function measurementSliderBounds(range?: { lowerCm: number; upperCm: number }, currentValue?: number) {
  const approved = range && Number.isFinite(range.lowerCm) && Number.isFinite(range.upperCm) && range.upperCm > range.lowerCm;
  const min = approved ? Math.max(1, Math.floor((range.lowerCm - 3) * 2) / 2) : 1;
  const max = approved ? Math.min(9999.5, Math.ceil((range.upperCm + 3) * 2) / 2) : 200;
  const entered = typeof currentValue === 'number' && Number.isFinite(currentValue) && currentValue >= 1 && currentValue <= 9999.5 ? currentValue : undefined;
  return { min: entered === undefined ? min : Math.min(min, entered), max: entered === undefined ? max : Math.max(max, entered), step: 0.5 };
}

export function applyParentPreset(entered: Draft['values'], preset: Record<string, number>): NonNullable<Draft['values']> {
  const values = { ...entered };
  for (const [key, value] of Object.entries(preset)) {
    if (!/^m([1-9]|1[0-7])$/.test(key) || key === 'm6' || values[key as MeasurementKey] !== undefined) continue;
    values[key as MeasurementKey] = value;
  }
  return values;
}

/** Only server-supplied, versioned rules are used. Body ranges have no client default. */
export function rangeForDraft(policy: RangePolicy | undefined, draft: Draft, field: number): RangeRule | undefined {
  if (!policy?.version) return undefined;
  const matching = policy.rules.filter(rule => {
    if (rule.field !== field || (rule.discipline && rule.discipline !== draft.discipline)) return false;
    if (rule.minHeightCm !== undefined || rule.maxHeightCm !== undefined) {
      if (draft.heightCm === undefined || !Number.isFinite(draft.heightCm)) return false;
      if (rule.minHeightCm !== undefined && draft.heightCm < rule.minHeightCm) return false;
      if (rule.maxHeightCm !== undefined && draft.heightCm > rule.maxHeightCm) return false;
    }
    return true;
  });
  return matching.find(rule => rule.discipline === draft.discipline && rule.discipline !== undefined) ?? matching.find(rule => !rule.discipline);
}

/** Shared backend contract: UUID version + short server rule id + field + canonical ticks. */
export function rangeAcknowledgement(policy: RangePolicy, rule: RangeRule, field: number, value: number) {
  return `${policy.version}:${rule.id}:m${field}:${Math.round(value * 2)}`;
}

export function rangeWarnings(policy: RangePolicy | undefined, draft: Draft) {
  const warnings: Array<{ field: number; rule: RangeRule; value: number; code: string; acknowledged: boolean }> = [];
  if (!policy?.version) return warnings;
  for (let field = 1; field <= 17; field++) {
    const value = draft.values?.[`m${field}`];
    const rule = rangeForDraft(policy, draft, field);
    if (!rule || value === undefined || !Number.isFinite(value) || (value >= rule.lowerCm && value <= rule.upperCm)) continue;
    const code = rangeAcknowledgement(policy, rule, field, value);
    warnings.push({ field, rule, value, code, acknowledged: draft.rangeVersion === policy.version && (draft.warningsAcknowledged ?? []).includes(code) });
  }
  return warnings;
}

/** Run for resume/new child/select and every edit, so a previous value's consent cannot return. */
export function syncDraftRanges(draft: Draft, policy?: RangePolicy): Draft {
  const version = policy?.version ?? undefined;
  const changedPolicy = draft.rangeVersion !== version;
  const validCodes = new Set(rangeWarnings(policy, draft).map(warning => warning.code));
  const acknowledged = changedPolicy ? [] : (draft.warningsAcknowledged ?? []).filter(code => validCodes.has(code));
  if (!changedPolicy && acknowledged.length === (draft.warningsAcknowledged ?? []).length) return draft;
  const next = { ...draft, warningsAcknowledged: acknowledged };
  if (version) next.rangeVersion = version; else delete next.rangeVersion;
  return next;
}
