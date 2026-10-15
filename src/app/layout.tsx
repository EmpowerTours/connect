import type { Metadata, Viewport } from "next";
import { getLocale } from "@/lib/auth";
import { APP_NAME } from "@/lib/constants";
import "./globals.css";

export const metadata: Metadata = {
  title: `${APP_NAME} — institutional blockchain BD`,
  description: "Partner pipeline, organization directory and signals for blockchain business development.",
};

export const viewport: Viewport = { themeColor: "#0a0b10", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
