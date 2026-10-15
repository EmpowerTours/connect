import { TabPage } from "@/components/layout";
import { Orbit, type OrbitNode } from "@/components/orbit";
import { TopLine } from "@/components/shell";
import { getLocale, requireUser } from "@/lib/auth";
import { buildCircle } from "@/lib/circle";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

export default async function CirclePage({ searchParams }: { searchParams: Promise<{ focus?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const { focus } = await searchParams;
  const edges = await prisma.followUser.findMany({ select: { followerId: true, followeeId: true } });
  const circle = buildCircle(edges, user.id, { ring1: 8, ring2: 8 });
  const ids = [...new Set(circle.flatMap((n) => [n.id, ...n.via]))];
  const people = new Map(
    (await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, handle: true, headline: true, orgName: true, isDemo: true } })).map((u) => [u.id, u]),
  );
  const nodes: OrbitNode[] = circle.flatMap((n) => {
    const p = people.get(n.id);
    if (!p) return [];
    return [{ ...p, ring: n.ring, via: n.via.map((v) => people.get(v)).filter((v): v is NonNullable<typeof v> => !!v) }];
  });
  const me = { id: user.id, name: user.name, handle: user.handle, headline: user.headline, orgName: user.orgName, isDemo: user.isDemo };

  return (
    <TabPage>
      <TopLine eyebrow={t(locale, "nav.circle")} user={me} />
      <div className="mt-3">
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] md:text-[40px]">{t(locale, "circle.title")}</h1>
        <p className="mt-1 text-[15px] text-muted">{t(locale, "circle.subtitle")}</p>
      </div>
      {nodes.length === 0 ? (
        <p className="glass mt-8 px-5 py-6 text-center text-sm text-muted">{t(locale, "circle.empty")}</p>
      ) : (
        <Orbit
          me={me}
          nodes={nodes}
          initialHandle={focus}
          labels={{
            you: t(locale, "circle.you"),
            warmPath: t(locale, "circle.warmPath"),
            requestVia: t(locale, "circle.requestVia"),
            direct: t(locale, "circle.direct"),
            viewProfile: t(locale, "nav.viewProfile"),
            alsoVia: t(locale, "circle.alsoVia"),
            hint: t(locale, "circle.hint"),
            first: t(locale, "circle.first"),
            second: t(locale, "circle.second"),
            close: t(locale, "circle.close"),
            demo: t(locale, "demo.badge"),
          }}
        />
      )}
    </TabPage>
  );
}
