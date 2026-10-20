import type { Metadata } from "next";
import {
  ColorSchemeScript,
  MantineProvider,
  mantineHtmlProps,
} from "@mantine/core";
import "@mantine/core/styles.css";
import "@mantine/dates/styles.css";
import { Notifications } from "@mantine/notifications";
import "@mantine/notifications/styles.css";
import "flag-icons/css/flag-icons.min.css";
import { yoleotardTheme } from "../lib/mantine-theme";
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
import "./mantine-overrides.css";
import "./finance-report.css";
import "./overview-workspace.css";
import "./order-source-analytics.css";
import "./sales-statistics.css";
import "./sales-statistics-map.css";
import "./tax-financial-integration.css";
import "./tax-integration-order-settings.css";

export const metadata: Metadata = {
  title: "CRM Yoleotard",
  description:
    "Рабочая система управления клиентами, заказами и производством Yoleotard",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ru" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript forceColorScheme="light" />
      </head>
      <body>
        <MantineProvider theme={yoleotardTheme} forceColorScheme="light">
          <Notifications position="top-right" autoClose={3000} limit={3} containerWidth={360} />
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
