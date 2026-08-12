import type { Metadata } from "next";
import {Inter} from "next/font/google";
import "./styles.css";import "./phase2.css";import "./crm-shell.css";import "./measurement-panel.css";import "./order-panel.css";import "./orders-workspace.css";import "./production-workspace.css";import "./finance-workspace.css";import "./invoice-editor.css";import "./typography.css";
export const metadata:Metadata={title:"CRM Yoleotard",description:"Рабочая система управления клиентами, заказами и производством Yoleotard"};
const inter=Inter({subsets:["latin","cyrillic"],display:"swap",variable:"--font-inter"});
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ru"><body className={inter.variable}>{children}</body></html>}

