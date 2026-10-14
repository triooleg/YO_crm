import catalog from "flag-icons/country.json" with { type: "json" };

const names = new Intl.DisplayNames(["ru"], { type: "region" });
const aliases = { us: ["USA", "United States", "США", "US United States"], gb: ["UK", "Great Britain", "Англия"], ua: ["Україна"] };
export const countryOptions = catalog.filter(country => country.iso || country.code === "xk").map(country => ({
  value: country.name,
  label: names.of(country.code.toUpperCase()) || country.name,
  code: country.code,
  aliases: aliases[country.code] || [],
})).sort((a,b) => a.label.localeCompare(b.label,"ru"));

export function normalizeCountrySearch(value) { return value.normalize("NFD").replace(/\p{M}/gu, "").trim().toLocaleLowerCase(); }
export function countryMatchesPrefix(country, search) {
  const prefix = normalizeCountrySearch(search);
  return [country.label, country.value, country.code, ...country.aliases].some(value => normalizeCountrySearch(value).startsWith(prefix));
}
export function findCountry(value) {
  const normalized = normalizeCountrySearch(value);
  return countryOptions.find(country => [country.value, country.label, country.code, ...country.aliases, `${country.code} ${country.value}`].some(name => normalizeCountrySearch(name) === normalized));
}
// Keep legacy spelling as the controlled value until the operator explicitly selects a country.
export function countryChoices(value) {
  if (!value || countryOptions.some(country => country.value === value)) return countryOptions;
  const match = findCountry(value);
  return [{ value, label: match?.label || value, code: match?.code || "", aliases: match?.aliases || [] }, ...countryOptions];
}
