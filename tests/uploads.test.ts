import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { LocalDiskStore, getBlobStore, isMediaKey, newAvatarKey } from "@/lib/storage";
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
  it("fails closed for drivers that do not exist yet", () => {
    expect(() => getBlobStore({ STORAGE_DRIVER: "s3" })).toThrow(/not implemented/);
    expect(getBlobStore({ STORAGE_DRIVER: "local", UPLOADS_DIR: path.join(tmpdir(), "connect-unused") })).toBeInstanceOf(LocalDiskStore);
  });
});
