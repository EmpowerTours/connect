/**
 * The relayer's hot-wallet key. It has no role in the contracts: it can only pay gas or refuse.
 *
 *   RELAYER_KEY       0x-prefixed 32-byte hex (a Railway secret), or
 *   RELAYER_KEY_FILE  absolute path to a file holding it, outside the repo, mode 0600
 *
 * The key is never logged, returned or put in an error message; callers only see the address.
 */
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

type Env = Record<string, string | undefined>;

export class RelayerKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RelayerKeyError";
  }
}

const KEY_RE = /^0x[0-9a-fA-F]{64}$/;

export interface KeyFs {
  read: (file: string) => string;
  mode: (file: string) => number;
}

const realFs: KeyFs = {
  read: (f) => readFileSync(f, "utf8"),
  mode: (f) => statSync(f).mode,
};

/** Returns the raw key. Internal: only {loadRelayerAccount} calls it. */
function readRelayerKey(env: Env, fs: KeyFs, repoRoot: string): `0x${string}` {
  const inline = env.RELAYER_KEY?.trim();
  const file = env.RELAYER_KEY_FILE?.trim();
  if (inline && file) throw new RelayerKeyError("set RELAYER_KEY or RELAYER_KEY_FILE, not both");
  let raw: string;
  if (inline) {
    raw = inline;
  } else if (file) {
    if (!path.isAbsolute(file)) throw new RelayerKeyError("RELAYER_KEY_FILE must be an absolute path");
    const abs = path.resolve(file);
    const root = path.resolve(repoRoot);
    if (abs === root || abs.startsWith(root + path.sep)) throw new RelayerKeyError("RELAYER_KEY_FILE must be outside the repository");
    let mode: number;
    try {
      mode = fs.mode(abs);
    } catch {
      throw new RelayerKeyError("RELAYER_KEY_FILE does not exist or can't be read");
    }
    if ((mode & 0o077) !== 0) throw new RelayerKeyError("RELAYER_KEY_FILE must be readable by its owner only (chmod 600)");
    raw = fs.read(abs).trim();
  } else {
    throw new RelayerKeyError("no relayer key: set RELAYER_KEY (Railway secret) or RELAYER_KEY_FILE");
  }
  const k = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!KEY_RE.test(k)) throw new RelayerKeyError("relayer key is not a 32-byte hex private key");
  return k as `0x${string}`;
}

export function loadRelayerAccount(env: Env = process.env, fs: KeyFs = realFs, repoRoot: string = process.cwd()): PrivateKeyAccount {
  return privateKeyToAccount(readRelayerKey(env, fs, repoRoot));
}
