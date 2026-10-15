"use client";

import { useRef, useState } from "react";
import { createPostAction } from "@/app/actions";
import { POST_MAX_LENGTH } from "@/lib/constants";

export function PostComposer({ placeholder, cta }: { placeholder: string; cta: string }) {
  const [len, setLen] = useState(0);
  const ref = useRef<HTMLFormElement>(null);
  return (
    <form
      ref={ref}
      action={async (fd) => {
        await createPostAction(fd);
        ref.current?.reset();
        setLen(0);
      }}
      className="card p-3"
    >
      <textarea
        name="body"
        required
        maxLength={POST_MAX_LENGTH}
        rows={3}
        onChange={(e) => setLen(e.target.value.length)}
        placeholder={placeholder}
        className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-zinc-500"
      />
      <div className="mt-2 flex items-center justify-between">
        <span className={`text-xs ${len > POST_MAX_LENGTH - 20 ? "text-amber-300" : "text-zinc-500"}`}>
          {len}/{POST_MAX_LENGTH}
        </span>
        <button className="btn-primary px-4 py-1.5" disabled={len === 0}>
          {cta}
        </button>
      </div>
    </form>
  );
}
