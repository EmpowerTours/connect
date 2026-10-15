"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, Route, X } from "lucide-react";
import { UserAvatar } from "./avatar";
import { anglePosition, orbitPositions, outerAngles } from "@/lib/circle";

export interface OrbitPerson {
  id: string;
  name: string;
  handle: string;
  headline: string;
  orgName: string;
  isDemo: boolean;
}
export interface OrbitNode extends OrbitPerson {
  ring: 1 | 2;
  via: OrbitPerson[];
}
export interface OrbitLabels {
  you: string;
  warmPath: string;
  requestVia: string;
  direct: string;
  viewProfile: string;
  alsoVia: string;
  hint: string;
  first: string;
  second: string;
  close: string;
  demo: string;
}

const first = (name: string) => name.split(" ")[0];

/** Concentric "warm network" orbit with a bottom sheet showing the warm path for the tapped person. */
export function Orbit({ me, nodes, labels, initialHandle }: { me: OrbitPerson; nodes: OrbitNode[]; labels: OrbitLabels; initialHandle?: string }) {
  const [selected, setSelected] = useState<OrbitNode | null>(() => nodes.find((n) => n.handle === initialHandle) ?? null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelected(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ring1 = nodes.filter((n) => n.ring === 1);
  const ring2 = nodes.filter((n) => n.ring === 2);
  const R1 = 29;
  const R2 = 44;
  const p1 = orbitPositions(ring1.length, R1);
  const p2 = outerAngles(
    ring1.length,
    ring2.map((n) => ring1.findIndex((r) => r.id === n.via[0]?.id)),
  ).map((deg) => anglePosition(deg, R2));

  return (
    <>
      <div className="relative mx-auto mt-4 aspect-square w-full max-w-[420px] select-none">
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full" aria-hidden>
          <defs>
            <radialGradient id="core" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#ede9fe" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#ede9fe" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="20" fill="url(#core)" />
          <circle cx="50" cy="50" r={R1} fill="none" stroke="#c4b5fd" strokeWidth="0.35" />
          <circle cx="50" cy="50" r={R2} fill="none" stroke="#d8d3e4" strokeWidth="0.3" strokeDasharray="1 1.4" />
          {selected && (() => {
            const idx1 = ring1.findIndex((n) => n.id === selected.id);
            const idx2 = ring2.findIndex((n) => n.id === selected.id);
            if (idx1 >= 0) return <line x1="50" y1="50" x2={p1[idx1].x} y2={p1[idx1].y} stroke="#7c3aed" strokeWidth="0.45" strokeLinecap="round" />;
            const viaIdx = ring1.findIndex((n) => n.id === selected.via[0]?.id);
            if (idx2 < 0 || viaIdx < 0) return null;
            return (
              <polyline
                points={`50,50 ${p1[viaIdx].x},${p1[viaIdx].y} ${p2[idx2].x},${p2[idx2].y}`}
                fill="none" stroke="#7c3aed" strokeWidth="0.45" strokeLinecap="round" strokeLinejoin="round"
              />
            );
          })()}
        </svg>

        {/* You */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <span className="relative block rounded-full bg-white p-1 shadow-[0_10px_30px_-10px_rgb(76_29_149/0.45)]">
            <UserAvatar name={me.name} seed={me.handle} size={74} />
            <span className="absolute bottom-1.5 right-1.5 h-3.5 w-3.5 rounded-full bg-accent ring-[3px] ring-white" />
          </span>
        </div>

        {ring1.map((n, i) => (
          <Node key={n.id} n={n} pos={p1[i]} size={46} active={selected?.id === n.id} dim={!!selected && selected.id !== n.id && selected.via[0]?.id !== n.id} onSelect={setSelected} />
        ))}
        {ring2.map((n, i) => (
          <Node key={n.id} n={n} pos={p2[i]} size={36} active={selected?.id === n.id} dim={!!selected && selected.id !== n.id} onSelect={setSelected} />
        ))}
      </div>

      <div className="mt-2 flex items-center justify-center gap-5 text-[12px] text-faint">
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-accent" /> {labels.first}</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-faint" /> {labels.second}</span>
      </div>

      {!selected && (
        <p className="glass mt-5 flex items-center gap-3 px-5 py-4 text-[14px] text-muted">
          <Route size={18} className="shrink-0 text-accent" /> {labels.hint}
        </p>
      )}

      {selected && <Sheet me={me} node={selected} labels={labels} onClose={() => setSelected(null)} />}
    </>
  );
}

function Node({ n, pos, size, active, dim, onSelect }: { n: OrbitNode; pos: { x: number; y: number }; size: number; active: boolean; dim: boolean; onSelect: (n: OrbitNode) => void }) {
  const inner = n.ring === 1;
  return (
    <button
      type="button"
      onClick={() => onSelect(n)}
      aria-label={`${n.name}${n.headline ? `, ${n.headline}` : ""}`}
      aria-pressed={active}
      className={`absolute flex -translate-x-1/2 flex-col items-center transition duration-300 ${dim ? "opacity-45" : "opacity-100"}`}
      style={{ left: `${pos.x}%`, top: `${pos.y}%`, marginTop: -size / 2 - 2 }}
    >
      <span className={`relative rounded-full bg-white p-[3px] transition ${active ? "scale-110 shadow-[0_0_0_3px_rgb(124_58_237/0.85),0_10px_24px_-8px_rgb(76_29_149/0.5)]" : "shadow-[0_6px_18px_-8px_rgb(76_29_149/0.4)] hover:scale-105"}`}>
        <UserAvatar name={n.name} seed={n.handle} size={size} />
        {inner && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-accent ring-2 ring-white" />}
      </span>
      <span className={`mt-1 max-w-[96px] truncate font-semibold leading-tight text-fg ${inner ? "text-[12px]" : "text-[11px] text-muted"}`}>{inner ? n.name.split(" ").slice(0, 2).join(" ") : first(n.name)}</span>
      {inner && n.headline && <span className="max-w-[92px] truncate text-[10.5px] leading-tight text-faint">{n.headline}</span>}
    </button>
  );
}

function Sheet({ me, node, labels, onClose }: { me: OrbitPerson; node: OrbitNode; labels: OrbitLabels; onClose: () => void }) {
  const connector = node.via[0];
  const path = node.ring === 1 ? [me, node] : [me, connector, node];
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center md:p-6" role="dialog" aria-modal="true" aria-label={labels.warmPath}>
      <button type="button" aria-label={labels.close} onClick={onClose} className="absolute inset-0 cursor-default bg-zinc-900/20 backdrop-blur-[2px] animate-fade-in" />
      <div className="relative w-full max-w-[480px] animate-rise rounded-t-[30px] border border-white bg-white/90 px-6 pb-[max(28px,env(safe-area-inset-bottom))] pt-3 shadow-[0_-20px_60px_-20px_rgb(76_29_149/0.35)] backdrop-blur-2xl md:rounded-[30px]">
        <span className="mx-auto mb-4 block h-1.5 w-10 rounded-full bg-line-strong md:hidden" />
        <button type="button" onClick={onClose} aria-label={labels.close} className="btn-ghost absolute right-4 top-4 h-9 w-9 p-0"><X size={18} /></button>
        <div className="flex items-center gap-3.5 pr-10">
          <UserAvatar name={node.name} seed={node.handle} size={52} />
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-[17px] font-semibold tracking-tight">
              <span className="truncate">{node.name}</span>
              {node.isDemo && <span className="rounded-md border border-amber-300 bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-800">{labels.demo}</span>}
            </p>
            <p className="truncate text-[13px] text-faint">{[node.headline, node.orgName].filter(Boolean).join(" · ")}</p>
          </div>
        </div>

        <div className="mt-5 rounded-[22px] bg-accent-soft/70 p-4">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-accent-ink"><Route size={14} /> {labels.warmPath}</p>
          <ol className="mt-3 flex items-start">
            {path.map((p, i) => (
              <li key={p.id} className="flex min-w-0 flex-1 items-start">
                <div className="flex min-w-0 flex-1 flex-col items-center text-center">
                  <UserAvatar name={p.name} seed={p.handle} size={36} ring />
                  <span className="mt-1.5 max-w-full truncate text-[13px] font-semibold">{i === 0 ? labels.you : first(p.name)}</span>
                  {i > 0 && p.headline && <span className="max-w-full truncate text-[11px] text-muted">{p.headline}</span>}
                </div>
                {i < path.length - 1 && <ArrowRight size={16} className="mt-2.5 shrink-0 text-accent" />}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-center text-[13px] text-muted">
            {path.map((p, i) => (i === 0 ? labels.you : i === path.length - 1 ? first(p.name) : `${first(p.name)}${p.headline ? ` (${p.headline})` : ""}`)).join(" → ")}
          </p>
        </div>

        {node.ring === 2 && node.via.length > 1 && (
          <p className="mt-3 text-center text-[12.5px] text-faint">{labels.alsoVia.replace("{names}", node.via.slice(1).map((v) => first(v.name)).join(", "))}</p>
        )}

        <div className="mt-5">
          {node.ring === 2 ? (
            <Link href={`/u/${node.handle}?intro=1&via=${connector.handle}`} className="btn-primary h-12 w-full text-[15px]">
              {labels.requestVia.replace("{name}", first(connector.name))} <ArrowRight size={16} />
            </Link>
          ) : (
            <>
              <p className="mb-3 text-center text-[13px] text-muted">{labels.direct}</p>
              <Link href={`/u/${node.handle}`} className="btn-secondary h-12 w-full text-[15px]">{labels.viewProfile}</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
