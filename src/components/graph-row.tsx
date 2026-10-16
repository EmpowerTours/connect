import Link from "next/link";
import { ArrowRightLeft, Building2, CircleCheck, CircleX, Handshake, ShieldCheck, ShieldX, UserMinus, UserPlus } from "lucide-react";
import { t, type Locale, type MessageKey } from "@/lib/i18n";
import { shortAddress } from "@/lib/mera/format";
import type { GraphAction } from "@/lib/graph/typed-data";

const ICONS: Record<GraphAction, typeof UserPlus> = {
  follow: UserPlus,
  unfollow: UserMinus,
  member: Building2,
  unmember: ArrowRightLeft,
  approve_member: ShieldCheck,
  revoke_member: ShieldX,
  intro: Handshake,
};

export interface Party {
  wallet: string;
  handle: string | null;
}

function PartyLink({ p, linkBase }: { p: Party; linkBase: string }) {
  const label = p.handle ? `@${p.handle}` : shortAddress(p.wallet);
  return (
    <Link href={`${linkBase}/${p.handle ?? p.wallet}`} className="font-semibold text-fg hover:text-accent">
      {label}
    </Link>
  );
}

/** Fills "{subject}", "{object}", "{org}" in a message with links / names. */
function fill(template: string, parts: Record<string, React.ReactNode>) {
  const out: React.ReactNode[] = [];
  const re = /\{(subject|object|org)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template))) {
    out.push(template.slice(last, m.index), <span key={m.index}>{parts[m[1]]}</span>);
    last = m.index + m[0].length;
  }
  out.push(template.slice(last));
  return out;
}

/**
 * One graph update in plain words. `mode="pending"` reads as an instruction
 * ("Follow @bea"); `mode="log"` reads as a record ("@ana follows @bea").
 */
export function GraphRow({
  locale,
  mode,
  action,
  author,
  subject,
  object,
  orgName,
  seq,
  issuedAt,
  valid,
  linkBase = "/graph",
}: {
  locale: Locale;
  mode: "pending" | "log";
  action: GraphAction;
  author?: Party;
  subject: Party | null;
  object: Party | null;
  orgName: string | null;
  seq?: number;
  issuedAt?: number;
  valid?: boolean;
  linkBase?: string;
}) {
  const Icon = ICONS[action];
  const key = `graph.${mode === "pending" ? "op" : "act"}.${action}` as MessageKey;
  const text = fill(t(locale, key), {
    subject: subject ? <PartyLink p={subject} linkBase={linkBase} /> : null,
    object: object ? <PartyLink p={object} linkBase={linkBase} /> : null,
    org: <span className="font-semibold text-fg">{orgName ?? "—"}</span>,
  });
  return (
    <div className="flex items-start gap-3 px-3.5 py-3">
      <span className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Icon size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[14.5px] leading-snug text-muted">
          {mode === "log" && author && (
            <>
              <PartyLink p={author} linkBase={linkBase} />{" "}
            </>
          )}
          {text}
        </p>
        {(seq !== undefined || issuedAt !== undefined) && (
          <p className="mt-0.5 font-mono text-[11.5px] text-faint">
            {seq !== undefined && `seq ${seq}`}
            {issuedAt !== undefined && ` · ${new Date(issuedAt * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`}
          </p>
        )}
      </div>
      {valid !== undefined && (
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${valid ? "bg-accent-soft text-accent-ink" : "bg-danger/10 text-danger"}`}
          title={t(locale, valid ? "graph.validHint" : "graph.invalid")}
        >
          {valid ? <CircleCheck size={12} /> : <CircleX size={12} />}
          {t(locale, valid ? "graph.valid" : "graph.invalid")}
        </span>
      )}
    </div>
  );
}
