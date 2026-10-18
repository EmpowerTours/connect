"use client";
/**
 * Connect ID on Monad (testnet, behind PROTOCOL_ENABLED). Shows the member's onchain ID and
 * device keys, and runs register / add / suspend / remove / revoke through the gateway.
 * English only while it is a testnet feature.
 */
import { useCallback, useEffect, useState } from "react";
import { Fingerprint, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import type { Address, Hex } from "viem";
import type { ClientConfig, Me, PendingOpRecord } from "@/lib/protocol/client";
import type { SelfSubmit } from "@/lib/protocol/self-submit";

type ClientMod = typeof import("@/lib/protocol/client");

const STATE = ["none", "active", "suspended", "retired", "removed"];
const short = (h: string) => `${h.slice(0, 8)}…${h.slice(-6)}`;
const day = (s: number) => new Date(s * 1000).toLocaleDateString();

export function ConnectIdPanel() {
  const [mod, setMod] = useState<ClientMod | null>(null);
  const [cfg, setCfg] = useState<ClientConfig | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [pending, setPending] = useState<PendingOpRecord[]>([]);
  const [recovery, setRecovery] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [hidden, setHidden] = useState(false);
  const [manual, setManual] = useState<{ reason: string; call: SelfSubmit } | null>(null);

  const load = useCallback(async () => {
    const m = await import("@/lib/protocol/client");
    setMod(m);
    const c = await m.fetchProtocolConfig();
    if (!c) return setHidden(true);
    setCfg(c);
    const first = await m.fetchMe();
    if (!first) return setHidden(true);
    const dev = await m.thisDeviceKey(c, first.wallet).catch(() => null);
    setMe(dev ? await m.fetchMe(dev.hash) : first);
    setPending(m.pendingOps(c, first.wallet));
  }, []);

  useEffect(() => {
    load().catch((e: unknown) => setMsg({ ok: false, text: e instanceof Error ? e.message : "Could not load your Connect ID." }));
  }, [load]);

  async function run(label: string, work: (m: ClientMod, c: ClientConfig, me: Me) => Promise<{ txHash: string; status: string }>) {
    if (!mod || !cfg || !me || busy) return;
    setBusy(label);
    setMsg(null);
    setManual(null);
    try {
      const r = await work(mod, cfg, me);
      setMsg({ ok: true, text: `${label}: ${r.status === "confirmed" ? "done" : "sent"} (fee sponsored) · ${short(r.txHash)}` });
      await load();
    } catch (e) {
      if (e instanceof mod.SelfSubmitNeeded) {
        setManual({ reason: e.reason, call: e.call });
        return;
      }
      const { explainPasskeyError } = await import("@/lib/mera/client");
      setMsg({ ok: false, text: explainPasskeyError(e) });
    } finally {
      setBusy(null);
    }
  }

  if (hidden) return null;
  if (!cfg || !me) return <section className="glass p-4 text-sm text-faint">{msg?.text ?? "Loading your Connect ID…"}</section>;

  const thisDevice = me.keys?.find((k) => k.thisDevice);
  const now = Math.floor(Date.now() / 1000);
  return (
    <section id="connect-id" className="glass space-y-3 p-4">
      <div>
        <h2 className="flex items-center gap-2 font-bold"><ShieldCheck size={18} /> Connect ID <span className="text-xs font-normal text-faint">{cfg.chainName}</span></h2>
        <p className="text-sm text-faint">Your Mera wallet owns your Connect ID. Each device gets its own key for daily signing. Owner and recovery changes wait {Math.round(cfg.longDelaySeconds / 86400) || `${cfg.longDelaySeconds}s`} days; key changes wait {Math.round(cfg.delaySeconds / 86400) || `${cfg.delaySeconds}s`} days, and you can cancel them.</p>
      </div>

      {!me.registered ? (
        <div className="space-y-2">
          <label className="block text-sm">
            Recovery address (recommended: a second Mera wallet on a different passkey)
            <input value={recovery} onChange={(e) => setRecovery(e.target.value.trim())} placeholder="0x… (optional)" className="input mt-1 w-full font-mono text-xs" />
          </label>
          <button
            type="button"
            className="btn-primary h-11 w-full"
            disabled={!!busy || me.paused || (recovery !== "" && !/^0x[0-9a-fA-F]{40}$/.test(recovery))}
            onClick={() => run("Register", (m, c, x) => m.registerConnectId(c, x, { recovery: (recovery || null) as Address | null }))}
          >
            {busy === "Register" ? <Loader2 size={18} className="animate-spin" /> : <Fingerprint size={18} />} Create my Connect ID
          </button>
          {me.paused && <p className="text-sm text-faint">New registrations are paused for now.</p>}
          {!me.sponsored && <SponsorCheck channels={cfg.sponsorChannels ?? []} onDone={load} />}
        </div>
      ) : (
        <>
          <p className="text-sm">ID <span className="font-mono">#{me.connectId}</span> · recovery {me.recovery ? <span className="font-mono">{short(me.recovery)}</span> : <span className="text-danger">not set</span>}</p>
          <ul className="space-y-2">
            {(me.keys ?? []).map((k) => (
              <li key={k.keyHash} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-black/5 p-2 text-sm dark:bg-white/5">
                <span className="flex items-center gap-2"><KeyRound size={14} /> <span className="font-mono text-xs">{short(k.keyHash)}</span>{k.thisDevice && <b className="text-xs">this device</b>}</span>
                <span className="text-xs text-faint">{STATE[k.state] ?? k.state}{k.guard ? " · guard" : ""} · expires {day(k.expiresAt)}</span>
                <span className="flex gap-2">
                  {k.thisDevice && k.state <= 2 && (
                    <button type="button" className="btn-secondary h-8 text-xs" disabled={!!busy} onClick={() => window.confirm("Revoke this device's key? It can't be undone.") && run("Revoke this device", (m, c, x) => m.retireThisDevice(c, x))}>Revoke</button>
                  )}
                  {!k.thisDevice && k.state === 1 && (
                    <button type="button" className="btn-secondary h-8 text-xs" disabled={!!busy} onClick={() => run("Suspend key", (m, c, x) => m.suspendKey(c, x, k.keyHash as Hex))}>Suspend</button>
                  )}
                  {!k.thisDevice && k.state <= 2 && (
                    <button type="button" className="btn-secondary h-8 text-xs" disabled={!!busy} onClick={() => run("Remove key", (m, c, x) => m.startRemoveKey(c, x, k.keyHash as Hex))}>Remove</button>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {!thisDevice && (
            <button type="button" className="btn-secondary h-10 w-full" disabled={!!busy} onClick={() => run("Add this device", (m, c, x) => m.startAddThisDevice(c, x))}>
              Add this device (ready in {Math.round(cfg.delaySeconds / 86400) || `${cfg.delaySeconds}s`} days; your other devices can cancel)
            </button>
          )}
          {pending.length > 0 && (
            <ul className="space-y-1 text-sm">
              {pending.map((p) => (
                <li key={`${p.op.kind}-${p.op.nonce}`} className="flex items-center justify-between gap-2">
                  <span>{p.label} · ready {new Date(p.readyAt * 1000).toLocaleString()}</span>
                  <button type="button" className="btn-secondary h-8 text-xs" disabled={!!busy || p.readyAt > now} onClick={() => run("Finalize", (m, c, x) => m.finalizeOp(c, x, p))}>Finalize</button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {manual && (
        <div role="status" className="space-y-2 rounded-xl bg-black/5 p-2.5 text-sm dark:bg-white/5">
          <p>{manual.reason}.</p>
          <p className="text-faint">Your request is signed. Send it from any wallet that has MON on {cfg.chainName} (it doesn&apos;t have to be your Mera wallet; the contract only checks your signatures). Value 0.</p>
          <p className="break-all font-mono text-xs">To: {manual.call.to}</p>
          <textarea readOnly rows={3} value={manual.call.data} className="input w-full font-mono text-[11px]" aria-label="Transaction data" />
          <button type="button" className="btn-secondary h-8 text-xs" onClick={() => void navigator.clipboard?.writeText(manual.call.data)}>Copy data</button>
        </div>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`rounded-xl p-2.5 text-sm ${msg.ok ? "bg-black/5 dark:bg-white/5" : "bg-danger/10 text-danger"}`}>{msg.text}</p>}
    </section>
  );
}

/** Earn sponsored fees with a one-time code (email by default; phone only when a provider exists). */
function SponsorCheck({ channels, onDone }: { channels: ("email" | "phone")[]; onDone: () => Promise<void> }) {
  const [channel, setChannel] = useState<"email" | "phone">(channels[0] ?? "email");
  const [address, setAddress] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  if (channels.length === 0) {
    return <p className="text-xs text-faint">Network fees are sponsored for members who joined with an invite link. Otherwise you can send your signed request from any wallet with a little MON.</p>;
  }

  async function step(work: () => Promise<void>) {
    setBusy(true);
    setNote(null);
    try {
      await work();
    } catch (e) {
      setNote({ ok: false, text: e instanceof Error ? e.message : "Something went wrong." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl bg-black/5 p-2.5 text-sm dark:bg-white/5">
      <p>Get free network fees: confirm {channels.length > 1 ? "an email or phone number" : channels[0] === "email" ? "your email" : "your phone number"} once. We keep only a fingerprint of it, never the address itself.</p>
      {!sentTo ? (
        <div className="flex flex-wrap gap-2">
          {channels.length > 1 && (
            <select value={channel} onChange={(e) => setChannel(e.target.value as "email" | "phone")} className="input h-10">
              {channels.map((c) => <option key={c} value={c}>{c === "email" ? "Email" : "Phone"}</option>)}
            </select>
          )}
          <input value={address} onChange={(e) => setAddress(e.target.value)} type={channel === "email" ? "email" : "tel"} autoComplete={channel === "email" ? "email" : "tel"} placeholder={channel === "email" ? "you@example.com" : "+52 55 1234 5678"} className="input h-10 min-w-0 flex-1" />
          <button type="button" className="btn-secondary h-10" disabled={busy || address.trim().length < 3} onClick={() => step(async () => {
            const { requestSponsorCode } = await import("@/lib/protocol/client");
            setSentTo((await requestSponsorCode(channel, address)).sentTo);
          })}>{busy ? <Loader2 size={16} className="animate-spin" /> : "Send code"}</button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-faint">Code sent to {sentTo}</span>
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" className="input h-10 w-28 font-mono" />
          <button type="button" className="btn-primary h-10" disabled={busy || code.length !== 6} onClick={() => step(async () => {
            const { confirmSponsorCode } = await import("@/lib/protocol/client");
            await confirmSponsorCode(code);
            setNote({ ok: true, text: "Confirmed. Your Connect ID fees are sponsored." });
            await onDone();
          })}>{busy ? <Loader2 size={16} className="animate-spin" /> : "Confirm"}</button>
          <button type="button" className="text-xs underline" disabled={busy} onClick={() => { setSentTo(null); setCode(""); }}>Use a different {channel === "email" ? "email" : "number"}</button>
        </div>
      )}
      {note && <p role="status" className={note.ok ? "text-sm" : "text-sm text-danger"}>{note.text}</p>}
      <p className="text-xs text-faint">Or skip this and send your signed request from any wallet with a little MON.</p>
    </div>
  );
}
