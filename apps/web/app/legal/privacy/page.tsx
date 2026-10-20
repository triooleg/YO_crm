import Link from "next/link";
import {legalUi} from "../../../lib/i18n";
import "../legal.css";
export default function PrivacyPage(){const t=legalUi.privacy;return <main className="legal-page"><article className="legal-card"><div className="legal-brand">{legalUi.brand}</div><h1>{t.title}</h1><p>{t.intro}</p>{t.sections.map(([title,text])=><section key={title}><h2>{title}</h2><p>{text}</p></section>)}<div className="legal-meta"><span>{legalUi.updated}</span><span>{legalUi.contact}</span></div><Link className="legal-back" href="/">← {legalUi.back}</Link></article></main>}
