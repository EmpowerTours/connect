"use client";

import { useFormStatus } from "react-dom";

/** Shimmering placeholder for an AI draft, shown inside a form while its server action runs. */
export function DraftPendingSkeleton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return (
    <div className="card animate-fade-in space-y-2.5 p-4" aria-busy="true" aria-live="polite">
      <p className="text-xs font-medium text-accent">{label}</p>
      <div className="skeleton h-3.5 w-1/3" />
      <div className="skeleton h-3.5 w-full" />
      <div className="skeleton h-3.5 w-11/12" />
      <div className="skeleton h-3.5 w-4/5" />
      <div className="skeleton h-3.5 w-2/5" />
    </div>
  );
}
