import { ImageResponse } from "next/og";
import { APP_FULL_NAME, APP_HOST } from "@/lib/brand";

/**
 * Link preview image (Open Graph and X cards) for every page. Rendered once at build time,
 * with Next's bundled font, so it adds no runtime cost and loads nothing from third parties.
 */
export const alt = `${APP_FULL_NAME}: warm intros and partnerships for blockchain BD`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: "linear-gradient(135deg, #f6f5f9 0%, #ede9fe 55%, #c4b5fd 100%)",
          color: "#1e1b2e",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: "#7c3aed", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: 22, height: 22, borderRadius: 11, background: "#ffffff" }} />
          </div>
          <div style={{ fontSize: 40, fontWeight: 700 }}>{APP_FULL_NAME}</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 700, lineHeight: 1.08, maxWidth: 980 }}>Warm intros and partnerships for blockchain BD</div>
          <div style={{ fontSize: 30, color: "#4c4566" }}>Foundations, financial institutions, fintechs and builders. Passkey sign-in, no seed phrase.</div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 26, color: "#5b21b6" }}>
          <div>{APP_HOST}</div>
          <div>Powered by Monad</div>
        </div>
      </div>
    ),
    size,
  );
}
