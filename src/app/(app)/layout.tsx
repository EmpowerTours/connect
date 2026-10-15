import { TabBar } from "@/components/nav-items";
import { SideRail } from "@/components/shell";
import { getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const locale = await getLocale();
  const pendingIntros = await prisma.intro.count({ where: { connectorId: user.id, status: "pending" } });
  const shellUser = { name: user.name, handle: user.handle, isDemo: user.isDemo };
  return (
    <>
      <div className="mx-auto flex max-w-[1200px]">
        <SideRail locale={locale} user={shellUser} pendingIntros={pendingIntros} />
        <div className="min-w-0 flex-1 pb-28 md:pb-10">{children}</div>
      </div>
      <TabBar locale={locale} />
    </>
  );
}
