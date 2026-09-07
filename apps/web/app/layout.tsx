import type { Metadata } from "next";
import "flag-icons/css/flag-icons.min.css";
import "./styles.css";
import "./phase2.css";
import "./crm-shell.css";
import "./measurement-panel.css";
import "./order-panel.css";
import "./orders-workspace.css";
import "./orders-dashboard.css";
import "./production-workspace.css";
import "./finance-workspace.css";
import "./invoice-editor.css";
import "./shipping-workspace.css";
import "./communications-workspace.css";
import "./communications-template-menu.css";
import "./tasks-workspace.css";
import "./typography.css";
import "./branding-settings.css";
import "./workspace-layout-standard.css";
import "./inbox-reference.css";

export const metadata: Metadata = {
  title: "CRM Yoleotard",
  description:
    "Рабочая система управления клиентами, заказами и производством Yoleotard",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
