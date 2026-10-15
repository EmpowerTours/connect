import { UserAvatar } from "@/components/avatar";
import { Composer } from "@/components/composer";
import { Columns, PageHeader } from "@/components/layout";
import { getLocale, requireUser } from "@/lib/auth";
import { t } from "@/lib/i18n";
import { getChannels } from "@/lib/post-ctx";

export default async function ComposePage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const user = await requireUser();
  const locale = await getLocale();
  const channels = await getChannels();
  const { channel } = await searchParams;
  return (
    <Columns>
      <PageHeader title={t(locale, "composer.newCast")} back="/more" />
      <div className="border-b border-line">
        <Composer
          locale={locale}
          channels={channels}
          defaultChannel={channel ?? ""}
          autoFocus
          redirectTo={channel ? `/channels/${channel}` : "/"}
          author={<UserAvatar name={user.name} seed={user.handle} size={42} />}
        />
      </div>
      <p className="px-4 py-4 text-sm text-faint">{t(locale, "composer.tips")}</p>
    </Columns>
  );
}
