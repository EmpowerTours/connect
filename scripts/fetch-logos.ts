/**
 * Fetches favicon-based logos for directory orgs into public/logos/<slug>.png
 * and writes src/lib/org-logos.json (slugs that have a logo). Orgs without a
 * usable icon fall back to generated initials in the UI.
 *   npm run logos
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const OUT = path.join(process.cwd(), "public", "logos");

function pngSize(buf: Buffer): { w: number; h: number } | null {
  if (buf.length < 24 || buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

async function main() {
  const orgs = await prisma.organization.findMany({ select: { slug: true, website: true } });
  const ok: string[] = [];
  for (const o of orgs) {
    if (!o.website) continue;
    const host = new URL(o.website).hostname;
    try {
      const res = await fetch(`https://www.google.com/s2/favicons?domain=${host}&sz=128`, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const size = pngSize(buf);
      if (!size || size.w < 48) continue; // tiny/default globe icons → initials instead
      writeFileSync(path.join(OUT, `${o.slug}.png`), buf);
      ok.push(o.slug);
    } catch {
      /* initials fallback */
    }
  }
  ok.sort();
  writeFileSync(path.join(process.cwd(), "src", "lib", "org-logos.json"), JSON.stringify(ok, null, 2) + "\n");
  console.log(`Logos: ${ok.length}/${orgs.length} fetched; others use initials.`);
}

main().finally(() => prisma.$disconnect());
