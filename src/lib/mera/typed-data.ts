/**
 * EIP-712 shapes for Mera passkey sign-in. Mirrors Hunt's lib/auth/typedData.ts.
 *
 * Client-safe: imports nothing server-only. The browser signs these with the
 * passkey-derived key and the server recovers the signer from the same shapes.
 *
 * Nothing here is a transaction. A Session signature is an off-chain proof of
 * wallet control; it moves no funds and never touches the chain.
 */
import { APP_FULL_NAME, BRAND } from "../brand";

/** Monad mainnet. Pinned into the domain so a signature cannot be replayed
 *  against another chain's deployment of the same app. */
export const MONAD_CHAIN_ID = 143;

export const APP_DOMAIN = {
  name: `${BRAND.ecosystem}${BRAND.name}`,
  version: "1",
  chainId: MONAD_CHAIN_ID,
} as const;

export const SESSION_TYPES = {
  Session: [
    { name: "wallet", type: "address" },
    { name: "statement", type: "string" },
    { name: "clientTs", type: "uint256" },
    { name: "nonce", type: "string" },
  ],
} as const;

/** Shown verbatim in the signature, and checked verbatim by the server. */
export const SESSION_STATEMENT = `Sign in to ${APP_FULL_NAME}. This does not authorise a transaction.`;

/**
 * Sign-up: proves control of the wallet AND binds the profile name and the
 * passkey credential id the user is registering with.
 */
export const REGISTRATION_TYPES = {
  Registration: [
    { name: "wallet", type: "address" },
    { name: "displayName", type: "string" },
    { name: "passkeyCredentialId", type: "string" },
    { name: "clientTs", type: "uint256" },
    { name: "nonce", type: "string" },
  ],
} as const;

/** Linking a Mera wallet to an existing (e.g. demo) profile. Same struct as
 *  Session, different pinned statement, so neither can stand in for the other. */
export const LINK_STATEMENT = `Link this wallet to my ${APP_FULL_NAME} profile. This does not authorise a transaction.`;

export function sessionTypedData(args: { wallet: string; clientTs: number; nonce: string; statement?: string }) {
  return {
    domain: APP_DOMAIN,
    types: SESSION_TYPES,
    primaryType: "Session" as const,
    message: {
      wallet: args.wallet as `0x${string}`,
      statement: args.statement ?? SESSION_STATEMENT,
      clientTs: BigInt(args.clientTs),
      nonce: args.nonce,
    },
  };
}

export function registrationTypedData(args: {
  wallet: string;
  displayName: string;
  passkeyCredentialId: string;
  clientTs: number;
  nonce: string;
}) {
  return {
    domain: APP_DOMAIN,
    types: REGISTRATION_TYPES,
    primaryType: "Registration" as const,
    message: {
      wallet: args.wallet as `0x${string}`,
      displayName: args.displayName,
      passkeyCredentialId: args.passkeyCredentialId,
      clientTs: BigInt(args.clientTs),
      nonce: args.nonce,
    },
  };
}
