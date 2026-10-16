/**
 * Blob storage for user uploads (profile photos), behind one small interface.
 *
 *   STORAGE_DRIVER=local (default) -> files under UPLOADS_DIR (default ./.data/uploads).
 *       On Railway, point UPLOADS_DIR at a mounted volume (e.g. /data/uploads); the
 *       container filesystem itself is wiped on every deploy.
 *   STORAGE_DRIVER=s3 (alias r2)   -> any S3-compatible bucket: Cloudflare R2 (recommended),
 *       AWS S3, Backblaze B2, MinIO. Needs S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID,
 *       S3_SECRET_ACCESS_KEY; S3_REGION defaults to "auto" (right for R2).
 *       The bucket stays private: photos are served through /media/... by this app.
 * Anything else fails closed.
 */
import { randomBytes } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { AwsClient } from "aws4fetch";

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

export interface S3Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

type FetchLike = (input: Request) => Promise<Response>;

/** S3-compatible store over plain HTTPS with SigV4 (aws4fetch: no AWS SDK, small memory footprint). */
export class S3Store implements BlobStore {
  private readonly client: AwsClient;
  private readonly base: string;
  constructor(
    cfg: S3Config,
    private readonly fetchFn: FetchLike = (r) => fetch(r),
  ) {
    this.client = new AwsClient({ accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: cfg.region, service: "s3" });
    // Path-style URLs work on R2, S3, B2 and MinIO alike.
    this.base = `${cfg.endpoint.replace(/\/+$/, "")}/${encodeURIComponent(cfg.bucket)}`;
  }

  private async send(method: string, key: string, init: { body?: Uint8Array; headers?: Record<string, string> } = {}): Promise<Response> {
    if (!isMediaKey(key)) throw new Error("invalid media key");
    const req = await this.client.sign(`${this.base}/${key}`, { method, body: init.body as BodyInit | undefined, headers: init.headers });
    return this.fetchFn(req);
  }

  async put(key: string, data: Uint8Array, contentType: string): Promise<void> {
    const res = await this.send("PUT", key, { body: data, headers: { "content-type": contentType, "cache-control": "public, max-age=31536000, immutable" } });
    if (!res.ok) throw new Error(`storage put failed: ${res.status}`);
  }

  async get(key: string): Promise<StoredBlob | null> {
    if (!isMediaKey(key)) return null;
    const res = await this.send("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`storage get failed: ${res.status}`);
    return { data: Buffer.from(await res.arrayBuffer()), contentType: TYPES[path.extname(key)] ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    if (!isMediaKey(key)) return;
    const res = await this.send("DELETE", key);
    if (!res.ok && res.status !== 404) throw new Error(`storage delete failed: ${res.status}`);
  }
}

/** S3 settings from env, or the names of the ones missing. */
export function s3ConfigFromEnv(env: Record<string, string | undefined>): { ok: true; config: S3Config } | { ok: false; missing: string[] } {
  const need = ["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
  const missing = need.filter((k) => !env[k]);
  if (missing.length) return { ok: false, missing };
  const endpoint = env.S3_ENDPOINT!;
  if (!/^https:\/\//.test(endpoint) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/.test(endpoint)) return { ok: false, missing: ["S3_ENDPOINT (https URL)"] };
  return {
    ok: true,
    config: { endpoint, bucket: env.S3_BUCKET!, accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY!, region: env.S3_REGION || "auto" },
  };
}

let store: BlobStore | null = null;

export function getBlobStore(env: Record<string, string | undefined> = process.env): BlobStore {
  if (env === process.env && store) return store;
  const driver = (env.STORAGE_DRIVER ?? "local").toLowerCase();
  let s: BlobStore;
  if (driver === "local") {
    s = new LocalDiskStore(env.UPLOADS_DIR || path.join(process.cwd(), ".data", "uploads"));
  } else if (driver === "s3" || driver === "r2") {
    const cfg = s3ConfigFromEnv(env);
    if (!cfg.ok) throw new Error(`STORAGE_DRIVER=${driver} needs ${cfg.missing.join(", ")}`);
    s = new S3Store(cfg.config);
  } else {
    throw new Error(`STORAGE_DRIVER=${driver} is not supported; use local or s3`);
  }
  if (env === process.env) store = s;
  return s;
}
