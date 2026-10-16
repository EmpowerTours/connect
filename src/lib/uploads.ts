/**
 * Profile photo validation and processing.
 *
 * - Type is decided by the file's magic bytes, never by its name or the
 *   browser-declared MIME type (only JPEG, PNG and WebP are accepted).
 * - Size: 1 byte .. MAX_UPLOAD_BYTES; dimensions: at least 64 px, at most
 *   MAX_PIXELS (decompression-bomb guard).
 * - Every image is re-encoded with sharp to a 512x512 WebP. Re-encoding drops
 *   ALL metadata (EXIF incl. GPS, XMP, ICC comments) and any trailing payload,
 *   and the EXIF orientation is applied to the pixels first.
 */
import sharp from "sharp";

// Memory: the server runs in a ~384 MB container. libvips' operation cache and one
// worker thread per core would hold far more than one 512 px avatar needs, so keep
// both off/minimal. Uploads are rare; a little latency is the right trade.
sharp.cache(false);
sharp.concurrency(1);

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const MIN_SIDE = 64;
export const AVATAR_SIZE = 512;

export type ImageKind = "jpeg" | "png" | "webp";
export type UploadError = "empty" | "too_large" | "type" | "dimensions" | "corrupt";

export function sniffImageType(b: Uint8Array): ImageKind | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((v, i) => b[i] === v)) return "png";
  if (
    b.length >= 12 &&
    String.fromCharCode(b[0], b[1], b[2], b[3]) === "RIFF" &&
    String.fromCharCode(b[8], b[9], b[10], b[11]) === "WEBP"
  )
    return "webp";
  return null;
}

/** Cheap checks before any decoding. */
export function precheckUpload(bytes: Uint8Array): { ok: true; kind: ImageKind } | { ok: false; error: UploadError } {
  if (bytes.length === 0) return { ok: false, error: "empty" };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: "too_large" };
  const kind = sniffImageType(bytes);
  if (!kind) return { ok: false, error: "type" };
  return { ok: true, kind };
}

/** Validate, then re-encode to a metadata-free square WebP. */
export async function processAvatar(bytes: Uint8Array): Promise<{ ok: true; data: Buffer; contentType: "image/webp" } | { ok: false; error: UploadError }> {
  const pre = precheckUpload(bytes);
  if (!pre.ok) return pre;
  try {
    const img = sharp(bytes, { limitInputPixels: MAX_PIXELS, failOn: "error" });
    const meta = await img.metadata();
    if (meta.format !== pre.kind && !(pre.kind === "jpeg" && meta.format === "jpeg")) return { ok: false, error: "type" };
    if (!meta.width || !meta.height || meta.width < MIN_SIDE || meta.height < MIN_SIDE) return { ok: false, error: "dimensions" };
    const data = await img
      .rotate() // bake in EXIF orientation before the metadata is dropped
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "attention" })
      .webp({ quality: 86 })
      .toBuffer(); // sharp writes no metadata unless asked (no .withMetadata/.keepMetadata)
    return { ok: true, data, contentType: "image/webp" };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    return { ok: false, error: /pixel limit/i.test(msg) ? "dimensions" : "corrupt" };
  }
}
