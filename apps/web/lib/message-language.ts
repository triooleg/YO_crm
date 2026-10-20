export function shouldOfferInboundTranslation(language?: string | null) {
  if (!language) return true;
  const normalized = language.trim().toLowerCase().split(/[-_]/, 1)[0];
  return normalized !== "ru" && normalized !== "uk";
}
