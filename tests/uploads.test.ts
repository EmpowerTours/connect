import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LocalDiskStore, S3Store, getBlobStore, isMediaKey, newAvatarKey, s3ConfigFromEnv } from "@/lib/storage";
import { MAX_UPLOAD_BYTES, precheckUpload, processAvatar, sniffImageType } from "@/lib/uploads";

const solid = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: { r: 124, g: 58, b: 237 } } });

describe("upload validation", () => {
  it("sniffs type from magic bytes, not names", async () => {
    expect(sniffImageType(new Uint8Array(await solid(80, 80).jpeg().toBuffer()))).toBe("jpeg");
    expect(sniffImageType(new Uint8Array(await solid(80, 80).png().toBuffer()))).toBe("png");
    expect(sniffImageType(new Uint8Array(await solid(80, 80).webp().toBuffer()))).toBe("webp");
    expect(sniffImageType(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(new TextEncoder().encode("GIF89a........"))).toBeNull();
  });
  it("rejects empty, oversized and non-image uploads before decoding", () => {
    expect(precheckUpload(new Uint8Array())).toEqual({ ok: false, error: "empty" });
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set([0xff, 0xd8, 0xff]);
    expect(precheckUpload(big)).toEqual({ ok: false, error: "too_large" });
    expect(precheckUpload(new TextEncoder().encode("%PDF-1.7 not an image"))).toEqual({ ok: false, error: "type" });
  });
  it("strips EXIF (incl. GPS-style tags) and re-encodes to a 512px WebP", async () => {
    const withExif = await solid(900, 600)
      .jpeg()
      .withExif({ IFD0: { Copyright: "secret-owner", Artist: "Ana" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "19/1 25/1 0/1" } })
      .toBuffer();
    expect((await sharp(withExif).metadata()).exif).toBeDefined();
    const out = await processAvatar(new Uint8Array(withExif));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const meta = await sharp(out.data).metadata();
    expect(meta.format).toBe("webp");
    expect([meta.width, meta.height]).toEqual([512, 512]);
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(out.data.includes(Buffer.from("secret-owner"))).toBe(false);
    expect(out.contentType).toBe("image/webp");
  });
  it("rejects tiny images and corrupt files that look like images", async () => {
    expect(await processAvatar(new Uint8Array(await solid(32, 32).png().toBuffer()))).toEqual({ ok: false, error: "dimensions" });
    const fake = new Uint8Array(200);
    fake.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(await processAvatar(fake)).toEqual({ ok: false, error: "corrupt" });
  });
  it("rejects a declared type that does not match the content", async () => {
    // PNG magic followed by a JPEG body: header says PNG, decoder disagrees.
    const jpeg = await solid(80, 80).jpeg().toBuffer();
    const mixed = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), jpeg]);
    const r = await processAvatar(new Uint8Array(mixed));
    expect(r.ok).toBe(false);
  });
});

describe("blob storage", () => {
  it("only accepts generated media keys (no traversal)", () => {
    expect(isMediaKey(newAvatarKey())).toBe(true);
    for (const k of ["../.env", "avatars/../../.env", "avatars/x.webp", "avatars/0123456789abcdef01234567.svg", "/etc/passwd"]) {
      expect(isMediaKey(k)).toBe(false);
    }
  });
  it("local disk store round-trips and refuses bad keys", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "connect-uploads-test-"));
    const store = new LocalDiskStore(dir);
    const key = newAvatarKey();
    await store.put(key, new Uint8Array([1, 2, 3]));
    expect(await store.get(key)).toEqual({ data: Buffer.from([1, 2, 3]), contentType: "image/webp" });
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    expect(await store.get("../../etc/passwd")).toBeNull();
    await expect(store.put("../escape.webp", new Uint8Array([1]))).rejects.toThrow(/invalid media key/);
  });
  it("fails closed for unknown drivers and for s3 without its settings", () => {
    expect(() => getBlobStore({ STORAGE_DRIVER: "ftp" })).toThrow(/not supported/);
    expect(() => getBlobStore({ STORAGE_DRIVER: "s3" })).toThrow(/S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY/);
    expect(() => getBlobStore({ ...S3_ENV, S3_ENDPOINT: "http://evil.example" })).toThrow(/https URL/);
    expect(getBlobStore({ STORAGE_DRIVER: "local", UPLOADS_DIR: path.join(tmpdir(), "connect-unused") })).toBeInstanceOf(LocalDiskStore);
    expect(getBlobStore(S3_ENV)).toBeInstanceOf(S3Store);
    expect(getBlobStore({ ...S3_ENV, STORAGE_DRIVER: "r2" })).toBeInstanceOf(S3Store);
  });
});

const S3_ENV = {
  STORAGE_DRIVER: "s3",
  S3_ENDPOINT: "https://acct123.r2.cloudflarestorage.com",
  S3_BUCKET: "connect-media",
  S3_ACCESS_KEY_ID: "test-access-key",
  S3_SECRET_ACCESS_KEY: "test-secret-key",
};

describe("S3-compatible store (fake endpoint, no network)", () => {
  function fakeBucket() {
    const objects = new Map<string, { body: Uint8Array; type: string }>();
    const seen: Request[] = [];
    const fetchFn = async (req: Request) => {
      seen.push(req);
      const key = new URL(req.url).pathname.replace(/^\/connect-media\//, "");
      if (req.method === "PUT") {
        objects.set(key, { body: new Uint8Array(await req.arrayBuffer()), type: req.headers.get("content-type") ?? "" });
        return new Response(null, { status: 200 });
      }
      if (req.method === "GET") {
        const o = objects.get(key);
        return o ? new Response(Buffer.from(o.body), { status: 200 }) : new Response("NoSuchKey", { status: 404 });
      }
      if (req.method === "DELETE") {
        objects.delete(key);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 405 });
    };
    const cfg = s3ConfigFromEnv(S3_ENV);
    if (!cfg.ok) throw new Error("config");
    return { store: new S3Store(cfg.config, fetchFn), objects, seen };
  }

  it("round-trips with signed, path-style requests to the bucket", async () => {
    const { store, objects, seen } = fakeBucket();
    const key = newAvatarKey();
    await store.put(key, new Uint8Array([7, 8, 9]), "image/webp");
    expect(objects.get(key)?.type).toBe("image/webp");
    expect(await store.get(key)).toEqual({ data: Buffer.from([7, 8, 9]), contentType: "image/webp" });
    await store.delete(key);
    expect(await store.get(key)).toBeNull();
    const put = seen[0];
    expect(put.url).toBe(`https://acct123.r2.cloudflarestorage.com/connect-media/${key}`);
    expect(put.headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=test-access-key\/\d{8}\/auto\/s3\/aws4_request/);
    expect(put.headers.get("x-amz-content-sha256")).toBeTruthy();
  });

  it("refuses bad keys before any request", async () => {
    const { store, seen } = fakeBucket();
    await expect(store.put("../escape.webp", new Uint8Array([1]), "image/webp")).rejects.toThrow(/invalid media key/);
    expect(await store.get("avatars/../../x")).toBeNull();
    await store.delete("/etc/passwd");
    expect(seen).toHaveLength(0);
  });
});
