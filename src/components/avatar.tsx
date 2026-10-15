import Image from "next/image";
import logos from "@/lib/org-logos.json";

const LOGOS = new Set<string>(logos as string[]);

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function initials(name: string) {
  return (
    name
      .replace(/\(.*?\)/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((p) => p[0])
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

/** Deterministic generated avatar: muted tint per person + initials. */
export function UserAvatar({ name, seed, size = 40, ring = false }: { name: string; seed?: string; size?: number; ring?: boolean }) {
  const hue = hash(seed ?? name) % 360;
  return (
    <span
      aria-hidden
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white ${ring ? "ring-4 ring-bg" : ""}`}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, size * 0.38),
        background: `linear-gradient(135deg, hsl(${hue} 45% 42%), hsl(${(hue + 40) % 360} 50% 28%))`,
      }}
    >
      {initials(name)}
    </span>
  );
}

/** Org logo from favicon cache (npm run logos) or an initials tile. */
export function OrgLogo({ slug, name, size = 40 }: { slug: string; name: string; size?: number }) {
  const radius = Math.round(size * 0.24);
  if (LOGOS.has(slug)) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center overflow-hidden bg-white" style={{ width: size, height: size, borderRadius: radius }}>
        <Image src={`/logos/${slug}.png`} alt="" width={size} height={size} className="h-[78%] w-[78%] object-contain" />
      </span>
    );
  }
  return (
    <span
      aria-hidden
      className="inline-flex shrink-0 items-center justify-center border border-line-strong bg-raised font-semibold text-muted"
      style={{ width: size, height: size, borderRadius: radius, fontSize: Math.max(10, size * 0.36) }}
    >
      {initials(name)}
    </span>
  );
}
