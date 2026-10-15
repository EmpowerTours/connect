"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, className = "btn-primary", name, value }: { children: React.ReactNode; className?: string; name?: string; value?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} disabled={pending} aria-busy={pending} name={name} value={value}>
      {pending ? <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : children}
    </button>
  );
}
