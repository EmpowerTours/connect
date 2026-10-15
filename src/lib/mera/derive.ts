/**
 * Key derivation for a Mera passkey wallet. Same scheme as Hunt's
 * lib/auth/derive.ts: 32 PRF bytes -> BIP-39 mnemonic -> m/44'/60'/0'/0/0.
 * Pure (no mera import) so it runs under vitest with no browser.
 */
import { HDKey } from "@scure/bip32";
import { entropyToMnemonic, mnemonicToSeedSync } from "@scure/bip39";
// @scure/bip39@1.x export map has no ".js" suffix on this path (same note as Hunt).
import { wordlist } from "@scure/bip39/wordlists/english";
import { sha256, stringToBytes } from "viem";

/** Standard first Ethereum account. Changing this orphans every wallet. */
export const ACCOUNT_PATH = "m/44'/60'/0'/0/0";

/**
 * This app's own 32-byte WebAuthn PRF salt. Distinct from Hunt's
 * ("empowertours-hunt/passkey/v1") so the same passkey yields a different
 * wallet here, even under the shared parent rpId empowertours.xyz.
 *
 * It MUST NEVER CHANGE — not even on a brand rename (which is why it is not
 * built from BRAND). tests/mera.test.ts pins the bytes.
 */
export const PRF_SALT_LABEL = "empowertours-connect/passkey/v1";
export const PRF_SALT: Uint8Array = sha256(stringToBytes(PRF_SALT_LABEL), "bytes");

export interface DerivedWallet {
  mnemonic: string;
  privateKey: Uint8Array;
}

export function walletFromPrfOutput(prfOutput: Uint8Array): DerivedWallet {
  if (prfOutput.length !== 32) {
    throw new Error(`expected 32 bytes of PRF output, got ${String(prfOutput.length)}`);
  }
  const mnemonic = entropyToMnemonic(prfOutput, wordlist);
  const node = HDKey.fromMasterSeed(mnemonicToSeedSync(mnemonic)).derive(ACCOUNT_PATH);
  if (node.privateKey === null) throw new Error("derivation produced no key");
  return { mnemonic, privateKey: node.privateKey };
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** A WebAuthn credential id is base64url, ≤ 256 chars here (Hunt's bound). */
export function isUsableCredentialId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0 && id.length <= 256 && id.length % 4 !== 1 && BASE64URL.test(id);
}

/** Relying-party guard, mirroring Hunt's assertOwnRelyingParty. */
export const FOREIGN_RP_IDS = ["hunt.empowertours.xyz", "regalo.empowertours.xyz"];
export const PARENT_RP_IDS = ["empowertours.xyz"];
const EXPECTED_SALT_LABEL = "empowertours-connect/passkey/v1";

export function assertOwnRelyingParty(rpId: string, saltLabel: string = PRF_SALT_LABEL): void {
  const id = rpId.toLowerCase();
  if (FOREIGN_RP_IDS.includes(id)) {
    throw new Error(`NEXT_PUBLIC_RP_ID is set to ${rpId}, which belongs to another EmpowerTours app.`);
  }
  if (PARENT_RP_IDS.includes(id) && saltLabel !== EXPECTED_SALT_LABEL) {
    throw new Error(
      `NEXT_PUBLIC_RP_ID is ${rpId} (shared across EmpowerTours subdomains) but the PRF salt label is "${saltLabel}"; ` +
        "under a parent rpId the salt is the only thing keeping this app's wallets apart.",
    );
  }
}
