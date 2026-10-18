import { redirect } from "next/navigation";
import { MemberShell } from "@/components/member-shell";
import { PublicFrame } from "@/components/public-frame";
import { getCurrentUser, getLocale } from "@/lib/auth";
import { needsOnboarding } from "@/lib/onboarding";

/**
 * Pages readable signed out (profiles, posts; src/lib/seo.ts PUBLIC_PREFIXES). Members get the
 * usual app shell; visitors get a slim header and a sign-up prompt that returns them here.
 * Pages render only public fields for visitors and never call requireUser() for reading.
 */
export default async function OpenLayout({ children }: { children: React.ReactNode }) {
  const [user, locale] = await Promise.all([getCurrentUser(), getLocale()]);
  if (!user) return <PublicFrame locale={locale}>{children}</PublicFrame>;
  if (needsOnboarding(user)) redirect("/welcome");
  return <MemberShell user={user} locale={locale}>{children}</MemberShell>;
}
