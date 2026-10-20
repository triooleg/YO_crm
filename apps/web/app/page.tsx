import { CrmShell } from "../components/crm-shell";
import { parseCrmSection } from "../lib/crm-sections";

// CRM shell is an authenticated/live workspace. It must not be served as a
// year-long cached static document, otherwise a browser can keep an obsolete
// client bundle after a production deployment.
export const dynamic = "force-dynamic";

export default async function Home({searchParams}:{searchParams:Promise<{section?:string|string[]}>}){
  const params=await searchParams;
  return <CrmShell initialSectionId={parseCrmSection(params.section)}/>;
}
