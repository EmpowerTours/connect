"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, Loader2 } from "lucide-react";

/** One passkey prompt signs every pending graph update (off-chain EIP-712; no transaction). */
export function GraphSignButton({ label, working, count }: { label: string; working: string; count: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    let m: typeof import("@/lib/mera/client") | null = null;
    try {
      m = await import("@/lib/mera/client");
      await m.signGraphUpdates();
      router.refresh();
    } catch (err) {
      setError(m ? m.explainPasskeyError(err) : "Could not load the passkey module.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-2">
      <button type="button" onClick={run} disabled={busy || count === 0} className="btn-primary h-12 w-full text-[15px] shadow-[0_10px_24px_-10px_rgb(124_58_237/0.7)]">
        {busy ? <Loader2 size={18} className="animate-spin" /> : <Fingerprint size={18} />}
        {busy ? working : label}
      </button>
      {error && <p role="alert" className="rounded-xl bg-danger/10 p-2.5 text-sm text-danger">{error}</p>}
    </div>
  );
}
