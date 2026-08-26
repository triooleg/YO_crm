import { CrmShell } from "../components/crm-shell";

// CRM shell is an authenticated/live workspace. It must not be served as a
// year-long cached static document, otherwise a browser can keep an obsolete
// client bundle after a production deployment.
export const dynamic = "force-dynamic";

export default function Home(){ return <CrmShell/>; }
