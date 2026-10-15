import { parseList } from "./json";

export const STAGES = ["awareness", "evaluation", "pilot", "committed", "lost"] as const;
export type Stage = (typeof STAGES)[number];
export const ACTIVE_STAGES: Stage[] = ["awareness", "evaluation", "pilot", "committed"];

export function isStage(value: string): value is Stage {
  return (STAGES as readonly string[]).includes(value);
}

/**
 * Stage-gate rules. Deals move one step forward at a time (no skipping
 * straight from awareness to committed), may move back any number of steps,
 * can be marked lost from anywhere, and can be revived from lost into any
 * active stage.
 */
export function canTransition(from: Stage, to: Stage): boolean {
  if (from === to) return false;
  if (to === "lost") return true;
  if (from === "lost") return true;
  const fi = ACTIVE_STAGES.indexOf(from);
  const ti = ACTIVE_STAGES.indexOf(to);
  return ti < fi || ti === fi + 1;
}

export function nextStage(stage: Stage): Stage | null {
  if (stage === "lost") return null;
  const i = ACTIVE_STAGES.indexOf(stage);
  return ACTIVE_STAGES[i + 1] ?? null;
}

export function prevStage(stage: Stage): Stage | null {
  if (stage === "lost") return null;
  const i = ACTIVE_STAGES.indexOf(stage);
  return i > 0 ? ACTIVE_STAGES[i - 1] : null;
}

export interface DealLike {
  id: string;
  stage: string;
  nextActionDue: Date | null;
  nextAction: string;
  competingChains: string;
  updatedAt: Date;
  org: { name: string };
}

export function groupByStage<T extends DealLike>(deals: T[]): Record<Stage, T[]> {
  const groups = Object.fromEntries(STAGES.map((s) => [s, [] as T[]])) as Record<Stage, T[]>;
  for (const deal of deals) {
    const stage = isStage(deal.stage) ? deal.stage : "awareness";
    groups[stage].push(deal);
  }
  for (const stage of STAGES) {
    groups[stage].sort((a, b) => {
      const ad = a.nextActionDue?.getTime() ?? Number.POSITIVE_INFINITY;
      const bd = b.nextActionDue?.getTime() ?? Number.POSITIVE_INFINITY;
      return ad - bd || a.org.name.localeCompare(b.org.name);
    });
  }
  return groups;
}

export type DueStatus = "none" | "overdue" | "today" | "soon" | "later";

/** Classifies a next-action due date relative to `now` (calendar days, local time). */
export function dueStatus(due: Date | null, now: Date = new Date()): DueStatus {
  if (!due) return "none";
  const startOf = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(due) - startOf(now)) / 86_400_000);
  if (days < 0) return "overdue";
  if (days === 0) return "today";
  if (days <= 7) return "soon";
  return "later";
}

/** Deals that are going dark: active, and either overdue or with no next action at all. */
export function needsAttention<T extends DealLike>(deals: T[], now: Date = new Date(), staleDays = 14): T[] {
  return deals.filter((d) => {
    if (d.stage === "lost" || d.stage === "committed") return false;
    if (!d.nextAction.trim()) return true;
    if (dueStatus(d.nextActionDue, now) === "overdue") return true;
    return now.getTime() - d.updatedAt.getTime() > staleDays * 86_400_000;
  });
}

/**
 * "Which institutions are evaluating competing chains": chain → org names,
 * across active deals, sorted by number of institutions.
 */
export function competingChainMap<T extends DealLike>(deals: T[]): { chain: string; orgs: string[] }[] {
  const map = new Map<string, { chain: string; orgs: Set<string> }>();
  for (const d of deals) {
    if (d.stage === "lost") continue;
    for (const chain of parseList(d.competingChains)) {
      const key = chain.toLowerCase();
      const entry = map.get(key) ?? { chain, orgs: new Set<string>() };
      entry.orgs.add(d.org.name);
      map.set(key, entry);
    }
  }
  return [...map.values()]
    .map((e) => ({ chain: e.chain, orgs: [...e.orgs].sort() }))
    .sort((a, b) => b.orgs.length - a.orgs.length || a.chain.localeCompare(b.chain));
}

export function stageCounts<T extends { stage: string }>(deals: T[]): Record<Stage, number> {
  const counts = Object.fromEntries(STAGES.map((s) => [s, 0])) as Record<Stage, number>;
  for (const d of deals) if (isStage(d.stage)) counts[d.stage] += 1;
  return counts;
}
