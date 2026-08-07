import type { Metadata } from "next";
import "./styles.css";
import "./phase2.css";
import "./crm-shell.css";

export const metadata: Metadata={title:"CRM Yoleotard",description:"Рабочая система управления клиентами, заказами и производством Yoleotard"};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="ru"><body>{children}</body></html>}
