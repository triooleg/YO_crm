const supportedClientLanguageCodes = new Set([
  "ar", "bg", "cs", "da", "de", "el", "en", "es", "et", "fa", "fi", "fr",
  "he", "hi", "hr", "hu", "id", "it", "ja", "ko", "lt", "lv", "nl", "no",
  "pl", "pt", "ro", "ru", "sk", "sl", "sr", "sv", "th", "tr", "uk", "vi", "zh",
]);

export function normalizeClientLanguageCode(value: unknown) {
  if (typeof value !== "string") return;
  const code = value.trim().toLowerCase();
  return supportedClientLanguageCodes.has(code) ? code : undefined;
}
