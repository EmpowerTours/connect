import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import { getLocale } from "@/lib/auth";
import { ROOT_METADATA } from "@/lib/seo";
import "./globals.css";

export const metadata: Metadata = ROOT_METADATA;

export const viewport: Viewport = { themeColor: "#f6f5f9", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
