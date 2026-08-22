import Link from "next/link";
import {legalUi} from "../../../lib/i18n";
import {DeletionStatus} from "./deletion-status";
import "../legal.css";
export default async function DataDeletionPage({searchParams}:{searchParams:Promise<{code?:string}>}){const {code}=await searchParams,t=legalUi.deletion;return <main className="legal-page"><article className="legal-card"><div className="legal-brand">{legalUi.brand}</div><h1>{t.title}</h1><p>{t.intro}</p>{code?<section><h2>{t.codeLabel}</h2><p><strong>{code}</strong></p><DeletionStatus code={code}/></section>:<p>{t.noCode}</p>}<h2>{t.stepsTitle}</h2><ol>{t.steps.map(step=><li key={step}>{step}</li>)}</ol><div className="legal-meta"><span>{legalUi.updated}</span><span>{legalUi.contact}</span></div><Link className="legal-back" href="/">← {legalUi.back}</Link></article></main>}
