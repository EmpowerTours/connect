import { TabBar } from "@/components/nav-items";
import { SideRail } from "@/components/shell";
import { redirect } from "next/navigation";
import { getLocale, requireUser } from "@/lib/auth";
import { needsOnboarding } from "@/lib/onboarding";
import { prisma } from "@/lib/db";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Real members finish onboarding first; the local demo user is exempt.
  if (needsOnboarding(user)) redirect("/welcome");
  const locale = await getLocale();
  const pendingIntros = await prisma.intro.count({ where: { connectorId: user.id, status: "pending" } });
  const shellUser = { name: user.name, handle: user.handle, isDemo: user.isDemo, avatarKey: user.avatarKey };
  return (
    <>
      <div className="mx-auto flex max-w-[1200px]">
        <SideRail locale={locale} user={shellUser} pendingIntros={pendingIntros} />
        <div className="pb-tabbar min-w-0 flex-1 md:pb-10">{children}</div>
      </div>
      <TabBar locale={locale} />
    </>
  );
}
