import Link from "next/link";
import { logoutAction, setLocaleAction } from "@/app/actions";
import { APP_NAME } from "@/lib/constants";
import { t, type Locale } from "@/lib/i18n";
import { Avatar } from "./ui";
import { NavLinks } from "./nav-links";

export function Nav({ locale, user }: { locale: Locale; user: { name: string; handle: string } }) {
  const links = [
    { href: "/pipeline", label: t(locale, "nav.pipeline"), icon: "▦" },
    { href: "/directory", label: t(locale, "nav.directory"), icon: "◎" },
    { href: "/feed", label: t(locale, "nav.feed"), icon: "≋" },
    { href: "/profile", label: t(locale, "nav.profile"), icon: "☺" },
  ];
  return (
    <>
      <header className="sticky top-0 z-30 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link href="/pipeline" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-5 w-5 rounded-md bg-gradient-to-br from-violet-500 to-fuchsia-500" />
            {APP_NAME}
          </Link>
          <nav className="hidden flex-1 md:block">
            <NavLinks links={links} variant="top" />
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <form action={setLocaleAction}>
              <input type="hidden" name="locale" value={locale === "en" ? "es" : "en"} />
              <button className="btn-ghost px-2 py-1 text-xs" title="EN / ES">
                {locale === "en" ? "ES" : "EN"}
              </button>
            </form>
            <Link href={`/u/${user.handle}`} className="hidden sm:block">
              <Avatar name={user.name} size={30} />
            </Link>
            <form action={logoutAction}>
              <button className="btn-ghost px-2 py-1 text-xs">{t(locale, "nav.logout")}</button>
            </form>
          </div>
        </div>
      </header>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg/95 backdrop-blur md:hidden">
        <NavLinks links={links} variant="bottom" />
      </nav>
    </>
  );
}
