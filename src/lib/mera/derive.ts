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
 * The EmpowerTours-wide 32-byte WebAuthn PRF salt, shared on purpose.
 *
 * Every EmpowerTours app (Hunt, TURBO, fcempowertours, Connect, and Regalo once
 * migrated) derives the wallet from the SAME passkey under the SAME relying-party
 * id (`empowertours.xyz`) with THIS salt, so one person has ONE address across the
 * ecosystem: a Hunt player or TURBO builder arrives on Connect already verified
 * as the same wallet.
 *
 * The label is Hunt's, byte for byte ("empowertours-hunt/passkey/v1"), because
 * Hunt and TURBO already have users under it. It is not renamed to something
 * neutral: a different label is a different PRF output is a different wallet for
 * every existing person. tests/mera.test.ts pins the exact bytes and checks the
 * derived address against Hunt's published test vector.
 *
 * It MUST NEVER CHANGE, not even on a brand rename (which is why it is not built
 * from BRAND).
 *
 * Safe to share here because Connect holds no funds and only ever asks this key
 * for off-chain EIP-712 sign-in signatures (domain "EmpowerToursConnect", so a
 * Connect signature can never be replayed against Hunt's or TURBO's domain).
 */
export const EMPOWERTOURS_PRF_SALT_LABEL = "empowertours-hunt/passkey/v1";
export const EMPOWERTOURS_PRF_SALT: Uint8Array = sha256(stringToBytes(EMPOWERTOURS_PRF_SALT_LABEL), "bytes");

/**
 * The shared parent relying-party id. A passkey is bound to its rpId, so the
 * shared salt only yields the shared wallet when the CREDENTIAL is shared too,
 * i.e. when every app runs its ceremonies under this parent domain.
 */
export const EMPOWERTOURS_RP_ID = "empowertours.xyz";

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

/**
 * Pinned here, apart from EMPOWERTOURS_PRF_SALT_LABEL above, so editing that
 * label cannot silently move this check with it.
 */
const EXPECTED_SALT_LABEL = "empowertours-hunt/passkey/v1";

/**
 * Relying-party guard.
 *
 * - `empowertours.xyz` (the shared parent) is the production value. The salt is
 *   re-checked against an independently pinned label, because under a parent
 *   rpId a wrong salt would hand every user a wallet that is NOT their
 *   EmpowerTours wallet, silently and permanently.
 * - Any `*.empowertours.xyz` host rpId (connect., hunt., regalo., ...) is refused:
 *   it would mint a per-host credential and therefore a different wallet from the
 *   one the person uses in Hunt and TURBO, which defeats the shared identity.
 * - Anything else (localhost, a tunnel or preview host) is allowed for local
 *   testing; credentials there are bound to that host and are not the ecosystem
 *   wallet.
 */
export function assertOwnRelyingParty(rpId: string, saltLabel: string = EMPOWERTOURS_PRF_SALT_LABEL): void {
  const id = rpId.toLowerCase();
  if (id.endsWith(`.${EMPOWERTOURS_RP_ID}`)) {
    throw new Error(
      `NEXT_PUBLIC_RP_ID is set to ${rpId}, a single EmpowerTours host. Use the shared parent ` +
        `"${EMPOWERTOURS_RP_ID}" so the passkey (and therefore the wallet) is the same one used across EmpowerTours apps.`,
    );
  }
  if (id === EMPOWERTOURS_RP_ID && saltLabel !== EXPECTED_SALT_LABEL) {
    throw new Error(
      `NEXT_PUBLIC_RP_ID is ${rpId} (shared across EmpowerTours subdomains) but the PRF salt label is "${saltLabel}" ` +
        `rather than "${EXPECTED_SALT_LABEL}"; users would get a different wallet from their EmpowerTours one.`,
    );
  }
}
