/**
 * Blob storage for user uploads, behind an interface so S3 / Cloudflare R2
 * can be added without touching callers.
 *
 *   STORAGE_DRIVER=local (default) -> files under UPLOADS_DIR (default ./.data/uploads)
 *   STORAGE_DRIVER=s3 | r2         -> not implemented yet (throws, fails closed)
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface StoredBlob {
  data: Buffer;
  contentType: string;
}

export interface BlobStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredBlob | null>;
  delete(key: string): Promise<void>;
}

/** Keys we generate: avatars/<24 hex>.webp. Anything else is refused (no traversal). */
export const MEDIA_KEY = /^avatars\/[a-f0-9]{24}\.webp$/;

export function isMediaKey(key: string): boolean {
  return MEDIA_KEY.test(key);
}

export function newAvatarKey(): string {
  return `avatars/${randomBytes(12).toString("hex")}.webp`;
}

const TYPES: Record<string, string> = { ".webp": "image/webp" };

export class LocalDiskStore implements BlobStore {
  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    if (!isMediaKey(key)) throw new Error("invalid media key");
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("invalid media key");
    return full;
  }

  async put(key: string, data: Uint8Array): Promise<void> {
    const p = this.pathFor(key);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, data);
  }

  async get(key: string): Promise<StoredBlob | null> {
    if (!isMediaKey(key)) return null;
    try {
      return { data: await readFile(this.pathFor(key)), contentType: TYPES[path.extname(key)] ?? "application/octet-stream" };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    if (!isMediaKey(key)) return;
    await rm(this.pathFor(key), { force: true });
  }
}

let store: BlobStore | null = null;

export function getBlobStore(env: Record<string, string | undefined> = process.env): BlobStore {
  const driver = (env.STORAGE_DRIVER ?? "local").toLowerCase();
  if (driver !== "local") throw new Error(`STORAGE_DRIVER=${driver} is not implemented yet; use local`);
  if (env === process.env && store) return store;
  const s = new LocalDiskStore(env.UPLOADS_DIR || path.join(process.cwd(), ".data", "uploads"));
  if (env === process.env) store = s;
  return s;
}
