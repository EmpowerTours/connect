"use client";

import Link from "next/link";
import { useOptimistic, useState, useTransition } from "react";
import { moveDealAction } from "@/app/actions";
import type { Locale } from "@/lib/i18n";
import { ORG_TYPE_LABELS, t } from "@/lib/i18n";
import { STAGES, canTransition, nextStage, prevStage, type DueStatus, type Stage } from "@/lib/pipeline";
import { DueChip, STAGE_COLORS } from "./ui";

export interface KanbanCard {
  id: string;
  stage: Stage;
  orgName: string;
  orgSlug: string;
  orgType: string;
  useCase: string;
  nextAction: string;
  due: string | null;
  dueStatus: DueStatus;
  competing: string[];
  contacts: number;
  champion: string | null;
}

export function Kanban({ cards, locale }: { cards: KanbanCard[]; locale: Locale }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [optimistic, applyMove] = useOptimistic(cards, (state, move: { id: string; stage: Stage }) =>
    state.map((c) => (c.id === move.id ? { ...c, stage: move.stage } : c)),
  );

  const move = (card: KanbanCard, to: Stage) => {
    if (!canTransition(card.stage, to)) {
      setError(locale === "es" ? "Mueve una etapa a la vez." : "Move one stage at a time.");
      return;
    }
    setError(null);
    start(async () => {
      applyMove({ id: card.id, stage: to });
      const res = await moveDealAction(card.id, to);
      if (!res.ok) setError(res.error ?? "Error");
    });
  };

  return (
    <div>
      {error && <p className="mb-3 rounded-lg bg-rose-500/10 px-3 py-2 text-sm text-rose-300">{error}</p>}
      <div className={`-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-3 ${pending ? "opacity-80" : ""}`}>
        {STAGES.map((stage) => {
          const col = optimistic.filter((c) => c.stage === stage);
          const dragged = optimistic.find((c) => c.id === dragging);
          const droppable = dragged ? canTransition(dragged.stage, stage) : false;
          return (
            <section
              key={stage}
              data-stage={stage}
              onDragOver={(e) => droppable && e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragged) move(dragged, stage);
                setDragging(null);
              }}
              className={`card flex w-[82vw] max-w-[300px] shrink-0 snap-start flex-col sm:w-[260px] xl:w-auto xl:max-w-none xl:min-w-0 xl:flex-1 xl:shrink ${
                droppable ? "border-violet-500/60 bg-violet-500/5" : ""
              } ${stage === "lost" ? "opacity-80" : ""}`}
            >
              <header className="flex items-center justify-between border-b border-line px-3 py-2.5">
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <span className={`h-2 w-2 rounded-full ${STAGE_COLORS[stage]}`} />
                  {t(locale, `stage.${stage}`)}
                </span>
                <span className="text-xs text-zinc-500">{col.length}</span>
              </header>
              <div className="flex min-h-32 flex-1 flex-col gap-2 p-2">
                {col.length === 0 && <p className="p-3 text-center text-xs text-zinc-600">{t(locale, "pipeline.empty")}</p>}
                {col.map((c) => {
                  const prev = prevStage(c.stage);
                  const next = nextStage(c.stage);
                  return (
                    <article
                      key={c.id}
                      draggable
                      onDragStart={() => setDragging(c.id)}
                      onDragEnd={() => setDragging(null)}
                      className="cursor-grab rounded-lg border border-line bg-bg p-3 active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/orgs/${c.orgSlug}`} className="font-medium hover:text-violet-300">
                          {c.orgName}
                        </Link>
                        <span className="shrink-0 text-[10px] uppercase tracking-wide text-zinc-500">{ORG_TYPE_LABELS[locale][c.orgType]}</span>
                      </div>
                      {c.useCase && <p className="mt-1 text-xs text-zinc-400">{c.useCase}</p>}
                      <div className="mt-2 space-y-1.5">
                        <p className="text-xs text-zinc-300">
                          <span className="text-zinc-500">→ </span>
                          {c.nextAction || <em className="text-rose-300/80">{locale === "es" ? "Sin siguiente acción" : "No next action"}</em>}
                        </p>
                        <div className="flex flex-wrap gap-1">
                          <DueChip status={c.dueStatus} date={c.due ? new Date(c.due) : null} locale={locale} />
                          {c.champion && <span className="chip border-emerald-500/40 text-emerald-300">★ {c.champion}</span>}
                          {c.competing.map((ch) => (
                            <span key={ch} className="chip border-rose-500/30 text-rose-200">vs {ch}</span>
                          ))}
                        </div>
                      </div>
                      <div className="mt-2 flex justify-between gap-1">
                        <button
                          type="button"
                          disabled={!prev}
                          onClick={() => prev && move(c, prev)}
                          className="rounded px-2 py-0.5 text-xs text-zinc-400 hover:bg-white/5 disabled:invisible"
                          aria-label="Move back"
                        >
                          ←
                        </button>
                        {c.stage !== "lost" ? (
                          <button
                            type="button"
                            onClick={() => move(c, "lost")}
                            className="rounded px-2 py-0.5 text-[11px] text-zinc-600 hover:text-rose-300"
                          >
                            {t(locale, "stage.lost")}
                          </button>
                        ) : (
                          <button type="button" onClick={() => move(c, "awareness")} className="rounded px-2 py-0.5 text-[11px] text-zinc-500 hover:text-white">
                            ↺ {t(locale, "stage.awareness")}
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={!next}
                          onClick={() => next && move(c, next)}
                          className="rounded px-2 py-0.5 text-xs text-zinc-300 hover:bg-white/5 disabled:invisible"
                          aria-label="Move forward"
                        >
                          →
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
