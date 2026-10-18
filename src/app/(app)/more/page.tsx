import Link from "next/link";
import { InviteButton } from "@/components/invite-button";
import { APP_URL } from "@/lib/brand";
import { ChevronRight, Hash, ShieldCheck, Handshake, KanbanSquare, Landmark, Languages, Lock, LogOut, Newspaper, PenLine, Radio, Share2, UserPlus } from "lucide-react";
import { logoutAction, setLocaleAction } from "@/app/actions";
import { UserAvatar } from "@/components/avatar";
import { avatarUrl } from "@/lib/media";
import { DemoBadge } from "@/components/badges";
import { TabPage } from "@/components/layout";
import { currentUserIsAdmin, getLocale, requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n";
import { inviteUrl } from "@/lib/invites";
import { ensureInviteCode, inviteCount } from "@/lib/invites-db";

export const metadata = { title: "Menu" };

const row = "flex w-full items-center gap-3.5 px-4 py-3.5 text-left text-[15px] transition hover:bg-white/80";
const icon = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink";

export default async function MorePage() {
  const user = await requireUser();
  const locale = await getLocale();
  // Demo accounts share the plain app link: their invites are never attributed (src/lib/invites-db.ts).
  const [pending, invite] = await Promise.all([
    prisma.intro.count({ where: { connectorId: user.id, status: "pending" } }),
    user.isDemo ? null : Promise.all([ensureInviteCode(user.id), inviteCount(user.id)]).then(([code, joined]) => ({ url: inviteUrl(APP_URL, code), joined })),
  ]);
  type Item = { href: string; label: string; Icon: typeof Hash; badge?: number; private?: boolean };
  const groups: { title: string; items: Item[] }[] = [
    {
      title: t(locale, "nav.network"),
      items: [
        { href: "/intros", label: t(locale, "nav.intros"), Icon: Handshake, badge: pending },
        { href: "/updates", label: t(locale, "nav.updates"), Icon: Newspaper },
        { href: "/channels", label: t(locale, "nav.channels"), Icon: Hash },
        { href: "/import", label: t(locale, "nav.import"), Icon: UserPlus },
        { href: "/sync", label: t(locale, "nav.graph"), Icon: Share2 },
      ],
    },
    {
      title: t(locale, "nav.work"),
      items: [
        { href: "/pipeline", label: t(locale, "nav.deals"), Icon: KanbanSquare, private: true },
        { href: "/orgs", label: t(locale, "nav.orgs"), Icon: Landmark },
        { href: "/signals", label: t(locale, "nav.signals"), Icon: Radio },
      ],
    },
  ];
  if (await currentUserIsAdmin()) groups.push({ title: t(locale, "admin.eyebrow"), items: [{ href: "/admin", label: t(locale, "admin.title"), Icon: ShieldCheck }] });
  return (
    <TabPage>
      <p className="eyebrow flex h-10 items-center">{t(locale, "nav.more")}</p>
      <Link href={`/u/${user.handle}`} className="glass mt-2 flex items-center gap-4 p-4 transition hover:bg-white/90">
        <UserAvatar name={user.name} seed={user.handle} src={avatarUrl(user.avatarKey)} size={56} />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5 text-[18px] font-semibold tracking-tight">
            <span className="truncate">{user.name}</span>
            {user.isDemo && <DemoBadge locale={locale} />}
          </span>
          <span className="block truncate text-[13px] text-faint">{[user.headline || user.role, user.orgName].filter(Boolean).join(" · ")}</span>
          <span className="mt-0.5 block text-[13px] font-semibold text-accent">{t(locale, "nav.viewProfile")}</span>
        </span>
        <ChevronRight size={18} className="text-faint" />
      </Link>

      <section className="glass mt-4 p-4" data-testid="invite">
        <p className="text-[15px] font-semibold tracking-tight">{t(locale, "invite.title")}</p>
        <p className="mt-0.5 text-[13px] leading-snug text-muted">{t(locale, "invite.body")}</p>
        {invite && (
          <div className="mt-3 rounded-2xl bg-raised/70 p-3">
            <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{t(locale, "invite.yourLink")}</p>
            <p className="mt-0.5 break-all font-mono text-[13px] text-fg" data-testid="invite-link">{invite.url}</p>
            <p className="mt-2 flex items-center gap-1.5 text-[13px] text-muted" data-testid="invite-count">
              <UserPlus size={14} className="text-accent" />
              {invite.joined === 0 ? t(locale, "invite.joinedNone") : invite.joined === 1 ? t(locale, "invite.joinedOne") : t(locale, "invite.joined").replace("{n}", String(invite.joined))}
            </p>
          </div>
        )}
        <div className="mt-3">
          <InviteButton url={invite?.url ?? APP_URL} text={t(locale, "invite.text")} label={t(locale, "invite.cta")} copiedLabel={t(locale, "invite.copied")} />
        </div>
      </section>

      {groups.map((g) => (
        <section key={g.title} className="mt-6">
          <h2 className="eyebrow mb-2 px-2">{g.title}</h2>
          <ul className="glass divide-y divide-line/70 overflow-hidden">
            {g.items.map(({ href, label, Icon, badge, private: isPrivate }) => (
              <li key={href}>
                <Link href={href} className={row}>
                  <span className={icon}><Icon size={17} /></span>
                  <span className="flex-1 font-medium">{label}</span>
                  {!!badge && <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">{badge}</span>}
                  {isPrivate && <Lock size={13} className="text-faint" />}
                  <ChevronRight size={17} className="text-faint" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      <section className="mt-6">
        <h2 className="eyebrow mb-2 px-2">{t(locale, "nav.account")}</h2>
        <ul className="glass divide-y divide-line/70 overflow-hidden">
          <li>
            <Link href="/profile" className={row}>
              <span className={icon}><PenLine size={17} /></span>
              <span className="flex-1 font-medium">{t(locale, "nav.editProfile")}</span>
              <ChevronRight size={17} className="text-faint" />
            </Link>
          </li>
          <li>
            <form action={setLocaleAction}>
              <input type="hidden" name="locale" value={locale === "en" ? "es" : "en"} />
              <button className={row} aria-label="Switch language">
                <span className={icon}><Languages size={17} /></span>
                <span className="flex-1 font-medium">{t(locale, "nav.language")}</span>
                <span className="text-[13px] font-semibold text-muted">{locale === "en" ? "English → Español" : "Español → English"}</span>
              </button>
            </form>
          </li>
          <li>
            <form action={logoutAction}>
              <button className={`${row} text-danger`}>
                <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-red-50 text-danger"><LogOut size={17} /></span>
                <span className="flex-1 font-medium">{t(locale, "nav.logout")}</span>
              </button>
            </form>
          </li>
        </ul>
      </section>
    </TabPage>
  );
}
