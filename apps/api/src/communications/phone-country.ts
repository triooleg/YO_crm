import { parsePhoneNumberFromString } from "libphonenumber-js/max";

const englishRegionNames = new Intl.DisplayNames(["en"], { type: "region" });

export function countryFromInternationalPhone(value?: string): string | undefined {
  const raw = String(value || "").trim();
  if (!raw) return undefined;
  const normalized = raw.startsWith("+") ? raw : `+${raw.replace(/\D/g, "")}`;
  if (normalized === "+") return undefined;
  const phone = parsePhoneNumberFromString(normalized);
  if (!phone?.country || !phone.isValid()) return undefined;
  return englishRegionNames.of(phone.country) || undefined;
}

export async function enrichWhatsappClientCountry(
  input: { channel: string; clientId: string; phone?: string },
  store: {
    updateEmptyCountry: (clientId: string, country: string) => Promise<boolean>;
    recordAudit: (clientId: string, country: string) => Promise<void>;
  },
): Promise<boolean> {
  if (input.channel !== "WHATSAPP") return false;
  const country = countryFromInternationalPhone(input.phone);
  if (!country || !await store.updateEmptyCountry(input.clientId, country)) return false;
  await store.recordAudit(input.clientId, country);
  return true;
}
