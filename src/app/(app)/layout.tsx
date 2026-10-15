import { Nav } from "@/components/nav";
import { getLocale, requireUser } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const locale = await getLocale();
  return (
    <>
      <Nav locale={locale} user={user} />
      <main className="mx-auto max-w-7xl px-4 pb-24 pt-6 md:pb-10">{children}</main>
    </>
  );
}
