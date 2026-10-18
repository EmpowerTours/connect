import "server-only";
import { getBlobStore, newAvatarKey } from "./storage";
import { processAvatar, type UploadError } from "./uploads";

/** True when the form carried a non-empty file in `field`. */
export function hasFile(fd: FormData, field: string): boolean {
  const f = fd.get(field);
  return f instanceof File && f.size > 0;
}

/**
 * Validate, re-encode (512 px WebP, metadata stripped) and store an uploaded image: the same path
 * as profile photos (src/lib/uploads.ts, src/lib/storage.ts). Returns the new storage key.
 */
export async function storeUploadedImage(file: File): Promise<{ ok: true; key: string } | { ok: false; error: UploadError }> {
  const out = await processAvatar(new Uint8Array(await file.arrayBuffer()));
  if (!out.ok) return out;
  const key = newAvatarKey();
  await getBlobStore().put(key, out.data, out.contentType);
  return { ok: true, key };
}

/** Best-effort removal of a stored image that nothing points at anymore. */
export async function deleteStoredImage(key: string | null | undefined): Promise<void> {
  if (!key) return;
  try {
    await getBlobStore().delete(key);
  } catch {
    // An orphaned file is harmless; never fail the user's action over it.
  }
}
