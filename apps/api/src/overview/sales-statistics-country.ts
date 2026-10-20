import catalog from './sales-statistics-country-data.json';

// Generated from the existing flag-icons country catalog; no customer-country inference.
const display = new Intl.DisplayNames(['ru'], { type: 'region' });
const regional = ['ru', 'uk', 'en'].map(locale => new Intl.DisplayNames([locale], { type: 'region' }));
const clean = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').replace(/[\p{Regional_Indicator}\uFE0F]/gu, '').trim().toLocaleLowerCase('en').replace(/[.,_]/g, ' ').replace(/\s+/g, ' ');
const index = new Map<string, string>();
for (const [code, name] of catalog) {
  if (!code || !name) continue;
  for (const value of [code, name, `${code} ${name}`, ...regional.map(names => names.of(code))]) if (value) index.set(clean(value), code);
}
const aliases: Record<string, string[]> = {
  US: ['USA', 'США', 'United States', 'Соединенные Штаты Америки', 'United States of America'],
  GB: ['UK', 'GBR', 'Great Britain', 'United Kingdom', 'Англия'],
  UA: ['UKR', 'Україна', 'Украина'], FR: ['FRA'], DE: ['DEU'], NL: ['NLD', 'Holland', 'Голландия'],
  CA: ['CAN'], ES: ['ESP'], IT: ['ITA'], IL: ['ISR'], CH: ['CHE'], CZ: ['CZE', 'Czech Republic'],
  LT: ['LTU'], AR: ['ARG'], AU: ['AUS'], BG: ['BGR'], HR: ['HRV'], SG: ['SGP'], AE: ['ARE', 'UAE'],
};
for (const [code, names] of Object.entries(aliases)) for (const name of names) { index.set(clean(name), code); index.set(clean(`${code} ${name}`), code); }
export function normalizeSalesCountry(value: string | null | undefined): { code: string | null; label: string } {
  const code = typeof value === 'string' ? index.get(clean(value)) : undefined;
  return { code: code ?? null, label: code ? display.of(code) || code : 'Не определена' };
}
export const salesCountryLabels = Object.fromEntries(catalog.filter(row => row[0]).map(([code]) => [code!, display.of(code!) || code!]));
