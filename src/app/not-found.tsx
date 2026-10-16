import Link from "next/link";
import type { Metadata } from "next";
import { StatusPage } from "@/components/status-page";
import { getLocale } from "@/lib/auth";
import { t } from "@/lib/i18n";

export const metadata: Metadata = { title: "Not found", robots: { index: false } };

export default async function NotFound() {
  const locale = await getLocale();
  return (
    <StatusPage code="404" title={t(locale, "status.notFound.title")} body={t(locale, "status.notFound.body")}>
      <Link href="/" className="btn-primary">
        {t(locale, "status.home")}
      </Link>
    </StatusPage>
  );
}
