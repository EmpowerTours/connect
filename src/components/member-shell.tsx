import { TabBar } from "@/components/nav-items";
import { SideRail } from "@/components/shell";
import { prisma } from "@/lib/db";
import type { Locale } from "@/lib/i18n";

/** The signed-in frame: desktop side rail, mobile tab bar. Used by the (app) and (open) layouts. */
export async function MemberShell({
  user,
  locale,
  children,
}: {
  user: { id: string; name: string; handle: string; isDemo: boolean; avatarKey: string | null };
  locale: Locale;
  children: React.ReactNode;
}) {
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
