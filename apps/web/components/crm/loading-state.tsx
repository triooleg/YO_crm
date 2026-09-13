import { Loader } from "@mantine/core";
export function CrmLoadingState({label,className}:{label:string;className?:string}){return <div className={className} role="status" aria-live="polite"><Loader size="sm" aria-hidden="true"/><span>{label}</span></div>}
