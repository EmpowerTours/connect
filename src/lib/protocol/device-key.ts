/**
 * Device message keys: non-extractable WebCrypto ECDSA P-256 keys. The private key never leaves
 * the browser's key store (not even to this app's own JavaScript), so a compromised page can USE
 * a key while it is open but can't copy it. Only the public key goes on chain.
 *
 * The pure helpers (key bytes, low-s signatures) are shared with the server and the tests.
 */
import { encodeAbiParameters, type Hex } from "viem";
import { KeyType, keyHashOf } from "./typed-data";

/** P-256 group order. The gateway rejects high-s signatures, so s is normalized to the low half. */
export const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");

function toHex(bytes: Uint8Array): Hex {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s as Hex;
}

function hexToBytes(hex: Hex): Uint8Array<ArrayBuffer> {
  const clean = hex.slice(2);
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean)) throw new Error("bad hex");
  const out = new Uint8Array(new ArrayBuffer(clean.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** WebCrypto "raw" public key (0x04 || x || y, 65 bytes) -> contract key bytes (x || y = abi.encode(x, y)). */
export function keyBytesFromRawPublicKey(raw: Uint8Array): Hex {
  if (raw.length !== 65 || raw[0] !== 0x04) throw new Error("expected an uncompressed P-256 public key");
  return toHex(raw.slice(1));
}

/** WebCrypto ECDSA signature (r || s, 64 bytes) -> abi.encode(r, s) with low s. */
export function lowSSignature(sig: Uint8Array): Hex {
  if (sig.length !== 64) throw new Error("expected a 64-byte P-256 signature");
  const r = BigInt(toHex(sig.slice(0, 32)));
  let s = BigInt(toHex(sig.slice(32)));
  if (s > P256_N / BigInt(2)) s = P256_N - s;
  return encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [r, s]);
}

export interface DeviceKey {
  /** Contract key bytes (x || y). */
  key: Hex;
  hash: Hex;
  keyType: typeof KeyType.P256;
  privateKey: CryptoKey;
}

/** A fresh non-extractable P-256 key pair. */
export async function generateDeviceKey(subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<DeviceKey> {
  const kp = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const raw = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  const key = keyBytesFromRawPublicKey(raw);
  return { key, hash: keyHashOf(KeyType.P256, key), keyType: KeyType.P256, privateKey: kp.privateKey };
}

/** Signs a 32-byte EIP-712 digest: ECDSA P-256 over sha256(digest), low s (what the gateway verifies). */
export async function signDigestWithDevice(d: Pick<DeviceKey, "privateKey">, digest: Hex, subtle: SubtleCrypto = globalThis.crypto.subtle): Promise<Hex> {
  const bytes = hexToBytes(digest);
  if (bytes.length !== 32) throw new Error("digest must be 32 bytes");
  const sig = new Uint8Array(await subtle.sign({ name: "ECDSA", hash: "SHA-256" }, d.privateKey, bytes));
  return lowSSignature(sig);
}

// ------------------------------------------------------------------ browser storage (IndexedDB)

const DB_NAME = "connect-protocol";
const STORE = "device-keys";

/** One key per (chain, gateway, owner wallet), so Solonet, testnet and redeploys never mix. */
export function deviceKeySlot(chainId: number, gateway: string, wallet: string): string {
  return `${chainId}:${gateway.toLowerCase()}:${wallet.toLowerCase()}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB unavailable"));
  });
}

async function withStore<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = work(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
    });
  } finally {
    db.close();
  }
}

interface StoredDeviceKey {
  key: Hex;
  hash: Hex;
  keyType: typeof KeyType.P256;
  privateKey: CryptoKey; // structured clone keeps it non-extractable
  createdAt: number;
}

export async function loadDeviceKey(slot: string): Promise<DeviceKey | null> {
  const v = await withStore<StoredDeviceKey | undefined>("readonly", (s) => s.get(slot));
  if (!v || !v.privateKey || v.privateKey.extractable) return null;
  return { key: v.key, hash: v.hash, keyType: v.keyType, privateKey: v.privateKey };
}

export async function saveDeviceKey(slot: string, d: DeviceKey): Promise<void> {
  const v: StoredDeviceKey = { key: d.key, hash: d.hash, keyType: d.keyType, privateKey: d.privateKey, createdAt: Date.now() };
  await withStore("readwrite", (s) => s.put(v, slot));
}

export async function forgetDeviceKey(slot: string): Promise<void> {
  await withStore("readwrite", (s) => s.delete(slot));
}
