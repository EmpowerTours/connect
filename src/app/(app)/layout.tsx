import { redirect } from "next/navigation";
import { MemberShell } from "@/components/member-shell";
import { getLocale, requireUser } from "@/lib/auth";
import { needsOnboarding } from "@/lib/onboarding";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // Real members finish onboarding first; the local demo user is exempt.
  if (needsOnboarding(user)) redirect("/welcome");
  const locale = await getLocale();
  return <MemberShell user={user} locale={locale}>{children}</MemberShell>;
}
