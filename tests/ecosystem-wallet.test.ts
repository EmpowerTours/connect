/**
 * Cross-app check: the same passkey must be the same wallet in Connect as in
 * EmpowerTours Hunt (and TURBO, whose lib/auth/derive.ts is byte-identical to
 * Hunt's).
 *
 * Hunt is not imported (separate repo). Instead:
 *   1. Hunt's published vector (its lib/auth/derive.test.ts: PRF = 32 x 0x07)
 *      and a second vector produced by running Hunt's own walletFromPrfOutput
 *      are pinned here as literals.
 *   2. Hunt's derivation is re-stated independently below (BIP-39 entropy ->
 *      mnemonic -> seed -> m/44'/60'/0'/0/0) and compared with Connect's.
 * The PRF bytes are fake fixed test inputs; no passkey, chain or RPC is involved.
 */
import { describe, expect, it } from "vitest";
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english";
import { bytesToHex, sha256, stringToBytes } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { EMPOWERTOURS_PRF_SALT, walletFromPrfOutput } from "@/lib/mera/derive";

/** Hunt's walletFromPrfOutput, restated (empowertours-hunt lib/auth/derive.ts). */
function huntAddress(prf: Uint8Array): string {
  const mnemonic = entropyToMnemonic(prf, wordlist);
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive("m/44'/60'/0'/0/0");
  if (!node.privateKey) throw new Error("no key");
  return privateKeyToAccount(bytesToHex(node.privateKey)).address;
}

function connectAddress(prf: Uint8Array): string {
  return privateKeyToAccount(bytesToHex(walletFromPrfOutput(prf).privateKey)).address;
}

const SEQ = Uint8Array.from({ length: 32 }, (_, i) => i);

const HUNT_VECTORS: { prf: Uint8Array; address: string }[] = [
  // From empowertours-hunt lib/auth/derive.test.ts.
  { prf: new Uint8Array(32).fill(7), address: "0x29458C602E3DB4fC3b54EC2bbEE26Dbe64C7779f" },
  // Produced by running Hunt's own walletFromPrfOutput on 0x00..0x1f.
  { prf: SEQ, address: "0xF9297b542BDb5DA50C364f9AE4Cbe1F3933bA40F" },
];

describe("Connect derives the same wallet as Hunt / TURBO", () => {
  it("uses Hunt's PRF salt bytes (sha256 of Hunt's label)", () => {
    expect(bytesToHex(EMPOWERTOURS_PRF_SALT)).toBe(bytesToHex(sha256(stringToBytes("empowertours-hunt/passkey/v1"), "bytes")));
  });

  for (const { prf, address } of HUNT_VECTORS) {
    it(`matches Hunt's address for PRF ${bytesToHex(prf).slice(0, 10)}…`, () => {
      expect(connectAddress(prf)).toBe(address);
      expect(huntAddress(prf)).toBe(address);
    });
  }

  it("agrees with Hunt's restated derivation on a spread of fake PRF outputs", () => {
    for (let k = 0; k < 8; k++) {
      const prf = sha256(stringToBytes(`connect-cross-check-${k}`), "bytes");
      expect(connectAddress(prf)).toBe(huntAddress(prf));
    }
  });
});

describe("the shared key is only ever asked for off-chain sign-in signatures", () => {
  // Sharing the wallet with Hunt/TURBO is only low-risk because Connect never
  // asks it to move funds. This pins that: no transaction-capable call anywhere
  // in src/, and the typed data carries no transaction-shaped fields.
  it("no source file sends, signs or prepares a transaction", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const root = new URL("../src", import.meta.url).pathname;
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    walk(root);
    expect(files.length).toBeGreaterThan(10);
    const FORBIDDEN = /sendTransaction|signTransaction|sendRawTransaction|eth_send|writeContract|prepareTransactionRequest|createWalletClient/;
    for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(FORBIDDEN);
  });

  it("Session/Registration typed data are sign-in proofs under Connect's own domain", async () => {
    const { APP_DOMAIN, REGISTRATION_TYPES, SESSION_TYPES, SESSION_STATEMENT, LINK_STATEMENT } = await import("@/lib/mera/typed-data");
    // Distinct from Hunt's "EmpowerToursHunt" domain, so a Connect signature from
    // the shared wallet cannot be replayed against Hunt or TURBO.
    expect(APP_DOMAIN.name).toBe("EmpowerToursConnect");
    expect(APP_DOMAIN.name).not.toBe("EmpowerToursHunt");
    const fields = [...SESSION_TYPES.Session, ...REGISTRATION_TYPES.Registration].map((f) => f.name);
    for (const banned of ["to", "value", "data", "amount", "gas", "spender"]) expect(fields).not.toContain(banned);
    expect(SESSION_STATEMENT).toMatch(/does not authorise a transaction/);
    expect(LINK_STATEMENT).toMatch(/does not authorise a transaction/);
  });
});
