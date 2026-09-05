import type { CrmSectionId } from "../lib/crm-sections";

const paths: Record<CrmSectionId, string> = {
  overview: "m3 10 9-7 9 7v10H3Z M9 20v-7h6v7",
  inbox: "M3 5h18v14H3Z m0 1 9 7 9-7",
  clients: "M16 21v-3a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v3 M15 4a4 4 0 0 1 0 8 M21 21v-3a4 4 0 0 0-3-3 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  orders: "M4 7h16v14H4Z M8 7V3h8v4 M8 11h8 M8 15h5",
  production: "m9 3-1 3-3 1 1 4-2 2 2 4 3-1 3 3 3-2 4 1 1-4-2-2 1-4-4-1-1-3Z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0",
  finance: "M3 8h18v12H3Z M3 8l13-5v5 M16 12h5v4h-5Z",
  shipping: "M2 5h12v13H2Z M14 10h4l4 5v3h-8 M8 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M20 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
  tasks: "M4 3h16v18H4Z m4 9 3 3 6-6",
  settings: "M3 6h18 M3 12h18 M3 18h18 M8 3v6 M16 9v6 M10 15v6",
};

export function CrmNavIcon({ section }: { section: CrmSectionId }) {
  return <svg className="crm-nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[section]}/></svg>;
}
