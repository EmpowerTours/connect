import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import { getLocale } from "@/lib/auth";
import { APP_NAME } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "The professional network for institutional blockchain business development.",
};

export const viewport: Viewport = { themeColor: "#09090b", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
