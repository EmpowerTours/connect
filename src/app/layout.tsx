import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import { getLocale } from "@/lib/auth";
import { APP_FULL_NAME, APP_NAME, APP_URL } from "@/lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: "The professional network for institutional blockchain business development.",
  metadataBase: new URL(APP_URL),
  alternates: { canonical: "/" },
  applicationName: APP_FULL_NAME,
  openGraph: { siteName: APP_FULL_NAME, url: APP_URL },
};

export const viewport: Viewport = { themeColor: "#f6f5f9", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
