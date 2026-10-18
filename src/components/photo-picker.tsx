"use client";

import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";

/** File input with an instant local preview. The server re-validates and re-encodes. `square` for org logos. */
export function PhotoPicker({
  current,
  fallback,
  label,
  hint,
  square = false,
}: {
  current: string | null;
  fallback: React.ReactNode;
  label: string;
  hint: string;
  square?: boolean;
}) {
  const round = square ? "rounded-[22%]" : "rounded-full";
  const [preview, setPreview] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const src = preview ?? current;
  return (
    <div className="flex items-center gap-4">
      <button type="button" onClick={() => input.current?.click()} className={`group relative shrink-0 ${round}`} aria-label={label}>
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element -- local preview / already-processed upload
          <img src={src} alt="" className={`h-[84px] w-[84px] ${round} object-cover ring-4 ring-white`} />
        ) : (
          fallback
        )}
        <span className="absolute -bottom-0.5 -right-0.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white ring-4 ring-white">
          <Camera size={15} />
        </span>
      </button>
      <div className="min-w-0">
        <button type="button" onClick={() => input.current?.click()} className="btn-secondary h-9 text-[13px]">{label}</button>
        <p className="mt-1.5 text-[12px] leading-snug text-faint">{hint}</p>
      </div>
      <input
        ref={input}
        type="file"
        name="photo"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          setPreview(f ? URL.createObjectURL(f) : null);
        }}
      />
    </div>
  );
}
