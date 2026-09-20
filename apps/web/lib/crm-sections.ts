export const crmSectionIds = [
  "overview",
  "inbox",
  "clients",
  "orders",
  "production",
  "finance",
  "shipping",
  "tasks",
  "settings",
] as const;

export type CrmSectionId = (typeof crmSectionIds)[number];

export function parseCrmSection(value: string | string[] | undefined): CrmSectionId {
  const candidate = Array.isArray(value) ? value[0] : value;
  return crmSectionIds.includes(candidate as CrmSectionId) ? candidate as CrmSectionId : "inbox";
}

export function crmSectionHref(section: CrmSectionId, currentSearch = "") {
  const params = new URLSearchParams(currentSearch);
  params.set("section", section);
  return `/?${params.toString()}`;
}
