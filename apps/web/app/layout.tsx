import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Yoleotard CRM",
  description: "Yoleotard operations workspace"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
