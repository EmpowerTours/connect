/**
 * EIP-712 shapes of the Connect protocol (ConnectGateway, domain "ConnectProtocol" v1).
 * Isomorphic: used by the browser to sign and by the server to check before relaying.
 * Must match contracts/src/ConnectGateway.sol (REGISTER_TYPEHASH, ACTION_TYPEHASH); the
 * Solonet end-to-end run (scripts/protocol-wiring-e2e.ts) checks the digests against the chain.
 */
import { encodeAbiParameters, keccak256, type Address, type Hex, type TypedDataDomain } from "viem";

export const EIP712_NAME = "ConnectProtocol";
export const EIP712_VERSION = "1";

export const Kind = {
  None: 0,
  TransferOwner: 1,
  ChangeRecovery: 2,
  AddKey: 3,
  RemoveKey: 4,
  UnsuspendKey: 5,
  RecoveryReset: 6,
  SuspendKey: 7,
  RetireKey: 8,
  Cancel: 9,
} as const;
export type KindValue = (typeof Kind)[keyof typeof Kind];

export const Signer = { None: 0, Owner: 1, OwnerDevice: 2, Recovery: 3, Device: 4 } as const;
export type SignerValue = (typeof Signer)[keyof typeof Signer];

export const KeyType = { P256: 1, Secp256k1: 2 } as const;

export const Scope = { POST: 1, REACT: 2, FOLLOW: 4, PROFILE: 8, ATTEST: 16, GUARD: 32, ALL: 63 } as const;

/** Key states in ConnectKeyRegistry.State. */
export const KeyState = { None: 0, Active: 1, Suspended: 2, Retired: 3, Removed: 4 } as const;

export const DAY = 86_400;
/** App defaults (design section 4): devices 1 year, mini apps 90 days; contract max 730 days. */
export const DEVICE_KEY_LIFETIME = 365 * DAY;
export const MINI_APP_KEY_LIFETIME = 90 * DAY;
export const MAX_KEY_LIFETIME = 730 * DAY;

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
export const ZERO32 = `0x${"0".repeat(64)}` as Hex;

export const registerTypes = {
  Register: [
    { name: "owner", type: "address" },
    { name: "recovery", type: "address" },
    { name: "keyType", type: "uint8" },
    { name: "keyHash", type: "bytes32" },
    { name: "scope", type: "uint8" },
    { name: "expiresAt", type: "uint40" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export const actionTypes = {
  Action: [
    { name: "id", type: "uint64" },
    { name: "kind", type: "uint8" },
    { name: "account", type: "address" },
    { name: "keyType", type: "uint8" },
    { name: "keyHash", type: "bytes32" },
    { name: "scope", type: "uint8" },
    { name: "expiresAt", type: "uint40" },
    { name: "flag", type: "bool" },
    { name: "opId", type: "bytes32" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function protocolDomain(chainId: number, gateway: Address): TypedDataDomain {
  return { name: EIP712_NAME, version: EIP712_VERSION, chainId, verifyingContract: gateway };
}

/** Contract input for `register`. `key` is the raw key bytes (P-256: x || y, 64 bytes). */
export interface RegisterParams {
  owner: Address;
  recovery: Address;
  keyType: number;
  key: Hex;
  scope: number;
  expiresAt: number;
  deadline: bigint;
}

export interface Action {
  id: bigint;
  kind: number;
  account: Address;
  keyType: number;
  keyHash: Hex;
  scope: number;
  expiresAt: number;
  flag: boolean;
  opId: Hex;
  deadline: bigint;
}

export interface DeviceSig {
  keyType: number;
  key: Hex;
  sig: Hex;
}

export interface Auth {
  signer: number;
  sig: Hex;
  device: DeviceSig;
}

export interface Op {
  id: bigint;
  kind: number;
  tier: number;
  account: Address;
  keyType: number;
  keyHash: Hex;
  scope: number;
  expiresAt: number;
  flag: boolean;
  nonce: bigint;
}

export const NO_DEVICE: DeviceSig = { keyType: 0, key: "0x", sig: "0x" };

/** keccak256(abi.encode(uint8 keyType, bytes key)), as ConnectKeyRegistry.keyHashOf. */
export function keyHashOf(keyType: number, key: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [keyType, key]));
}

/** The typed-data message for a Register (the key is committed by its hash). */
export function registerMessage(p: RegisterParams, nonce: bigint) {
  return {
    owner: p.owner,
    recovery: p.recovery,
    keyType: p.keyType,
    keyHash: keyHashOf(p.keyType, p.key),
    scope: p.scope,
    expiresAt: p.expiresAt,
    nonce,
    deadline: p.deadline,
  };
}

export function registerTypedData(domain: TypedDataDomain, p: RegisterParams, nonce: bigint) {
  return { domain, types: registerTypes, primaryType: "Register" as const, message: registerMessage(p, nonce) };
}

export function actionTypedData(domain: TypedDataDomain, a: Action, nonce: bigint) {
  return { domain, types: actionTypes, primaryType: "Action" as const, message: { ...a, nonce } };
}

/** An Action with every unused field zero. */
export function emptyAction(id: bigint, kind: number, deadline: bigint, extra: Partial<Action> = {}): Action {
  return {
    id,
    kind,
    account: ZERO_ADDRESS,
    keyType: 0,
    keyHash: ZERO32,
    scope: 0,
    expiresAt: 0,
    flag: false,
    opId: ZERO32,
    deadline,
    ...extra,
  };
}

/** The pending op that `start(a, auth)` creates when the signer's nonce was `nonce`. */
export function opFromAction(a: Action, tier: number, nonce: bigint): Op {
  return {
    id: a.id,
    kind: a.kind,
    tier,
    account: a.account,
    keyType: a.keyType,
    keyHash: a.keyHash,
    scope: a.scope,
    expiresAt: a.expiresAt,
    flag: a.flag,
    nonce,
  };
}

const opTuple = [
  {
    type: "tuple",
    components: [
      { name: "id", type: "uint64" },
      { name: "kind", type: "uint8" },
      { name: "tier", type: "uint8" },
      { name: "account", type: "address" },
      { name: "keyType", type: "uint8" },
      { name: "keyHash", type: "bytes32" },
      { name: "scope", type: "uint8" },
      { name: "expiresAt", type: "uint40" },
      { name: "flag", type: "bool" },
      { name: "nonce", type: "uint64" },
    ],
  },
] as const;

/** keccak256(abi.encode(op)), as ConnectGateway.opIdOf. */
export function opIdOf(op: Op): Hex {
  return keccak256(encodeAbiParameters(opTuple, [op]));
}

/** Which nonce a signer tier uses. Owner and owner + device share the owner nonce. */
export function nonceSource(signer: number): "owner" | "recovery" | "device" {
  if (signer === Signer.Recovery) return "recovery";
  if (signer === Signer.Device) return "device";
  return "owner";
}

/** True for a well-formed scope bitmask (no unknown bits, not empty). */
export function isValidScope(scope: number): boolean {
  return Number.isInteger(scope) && scope > 0 && (scope & ~Scope.ALL) === 0;
}
