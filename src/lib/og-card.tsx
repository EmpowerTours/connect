import { ImageResponse } from "next/og";
import { APP_FULL_NAME, APP_HOST } from "./brand";

/** Link preview size shared by every Open Graph / X card image. */
export const OG_SIZE = { width: 1200, height: 630 };

/**
 * The per-page preview card (profiles, posts), in the same look as src/app/opengraph-image.tsx.
 * No remote images (the avatar is drawn as initials). Text uses Next's bundled font; next/og
 * fetches emoji and non-Latin glyphs on demand when a post contains them.
 */
export function ogCard(p: { initials: string; name: string; handle: string; line?: string; body?: string; footer?: string }) {
  const body = p.body ?? "";
  const bodySize = body.length > 200 ? 34 : body.length > 110 ? 42 : 52;
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "64px 80px",
          background: "linear-gradient(135deg, #f6f5f9 0%, #ede9fe 55%, #c4b5fd 100%)",
          color: "#1e1b2e",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <div style={{ width: 112, height: 112, borderRadius: 56, background: "#7c3aed", color: "#ffffff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 46, fontWeight: 700 }}>
            {p.initials}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 860 }}>
            <div style={{ fontSize: 50, fontWeight: 700, lineHeight: 1.1 }}>{p.name}</div>
            <div style={{ fontSize: 28, color: "#5b21b6" }}>{`@${p.handle}`}</div>
            {p.line ? <div style={{ fontSize: 28, color: "#4c4566" }}>{p.line}</div> : null}
          </div>
        </div>
        {body ? <div style={{ display: "flex", fontSize: bodySize, fontWeight: 600, lineHeight: 1.25, maxWidth: 1040 }}>{body}</div> : <div style={{ display: "flex" }} />}
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#5b21b6" }}>
          <div style={{ display: "flex" }}>{p.footer ?? APP_FULL_NAME}</div>
          <div style={{ display: "flex" }}>{APP_HOST}</div>
        </div>
      </div>
    ),
    OG_SIZE,
  );
}

/** "Ana Ruiz" → "AR", "ana" → "A". */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** "1 reply", "3 replies". English only, like the rest of the preview card. */
export function countLabel(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
