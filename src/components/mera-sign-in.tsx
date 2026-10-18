"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, KeyRound, Loader2, Sparkles } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import { safeNextPath } from "@/lib/links";

type Busy = null | "signin" | "create" | "link-existing" | "link-new";

/** Mera is browser-only; load it on click so it never runs during SSR. */
const mera = () => import("@/lib/mera/client");

function useMeraAction(onDone: () => void) {
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  async function run(kind: Exclude<Busy, null>, work: (m: Awaited<ReturnType<typeof mera>>) => Promise<void>) {
    if (busy) return;
    setBusy(kind);
    setError(null);
    let m: Awaited<ReturnType<typeof mera>> | null = null;
    try {
      m = await mera();
      await work(m);
      onDone();
    } catch (err) {
      setError(m ? m.explainPasskeyError(err) : "Could not load the passkey module.");
    } finally {
      setBusy(null);
    }
  }
  return { busy, error, run };
}

/** Sign in / sign up with a Mera passkey wallet. The only wallet this app supports. */
export function MeraSignIn({ locale, next = null }: { locale: Locale; next?: string | null }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const { busy, error, run } = useMeraAction(() => {
    // Re-checked here too: the prop is server-validated, this keeps the component safe on its own.
    router.replace(safeNextPath(next) ?? "/");
    router.refresh();
  });

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => run("signin", (m) => m.signInWithPasskey())}
        disabled={!!busy}
        className="btn-primary h-12 w-full text-[15px] shadow-[0_10px_24px_-10px_rgb(124_58_237/0.7)]"
      >
        {busy === "signin" ? <Loader2 size={18} className="animate-spin" /> : <Fingerprint size={18} />}
        {busy === "signin" ? t(locale, "login.mera.working") : t(locale, "login.mera.signIn")}
      </button>

      {!creating ? (
        <p className="text-center text-sm text-muted">
          {t(locale, "login.mera.newHere")}{" "}
          <button type="button" onClick={() => setCreating(true)} className="font-semibold text-accent hover:underline">
            {t(locale, "login.mera.create")}
          </button>
        </p>
      ) : (
        <form
          className="space-y-2.5 rounded-2xl border border-lilac/70 bg-accent-soft/40 p-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            void run("create", (m) => m.createWalletWithPasskey(name));
          }}
        >
          <label className="label" htmlFor="mera-name">{t(locale, "login.mera.name")}</label>
          <input
            id="mera-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={60}
            autoComplete="name"
            className="input"
            placeholder={t(locale, "login.mera.namePlaceholder")}
          />
          <button disabled={!!busy || !name.trim()} className="btn-secondary h-11 w-full border-accent/40 text-accent-ink">
            {busy === "create" ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            {busy === "create" ? t(locale, "login.mera.working") : t(locale, "login.mera.createCta")}
          </button>
        </form>
      )}

      {error && <p role="alert" className="rounded-xl bg-danger/10 p-2.5 text-sm text-danger">{error}</p>}
    </div>
  );
}

/** For a signed-in profile without a wallet (e.g. the local demo user). */
export function MeraLinkWallet({ locale, displayName }: { locale: Locale; displayName: string }) {
  const router = useRouter();
  const { busy, error, run } = useMeraAction(() => router.refresh());
  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={() => run("link-existing", (m) => m.linkWalletWithPasskey("existing", displayName))} className="btn-primary h-10 text-sm">
          {busy === "link-existing" ? <Loader2 size={16} className="animate-spin" /> : <Fingerprint size={16} />}
          {t(locale, "wallet.linkExisting")}
        </button>
        <button type="button" disabled={!!busy} onClick={() => run("link-new", (m) => m.linkWalletWithPasskey("new", displayName))} className="btn-secondary h-10 text-sm">
          {busy === "link-new" ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
          {t(locale, "wallet.linkNew")}
        </button>
      </div>
      {error && <p role="alert" className="rounded-xl bg-danger/10 p-2.5 text-sm text-danger">{error}</p>}
    </div>
  );
}
