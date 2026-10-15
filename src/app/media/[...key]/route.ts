import { getBlobStore, isMediaKey } from "@/lib/storage";

export const dynamic = "force-dynamic";

/** Public profile photos. Keys are random and immutable, so they cache forever. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  const key = (await params).key.join("/");
  if (!isMediaKey(key)) return new Response("Not found", { status: 404 });
  const blob = await getBlobStore().get(key);
  if (!blob) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(blob.data), {
    headers: {
      "content-type": blob.contentType,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
    },
  });
}
