/**
 * Wire format between the browser and the relay endpoints. Isomorphic. bigints travel as decimal
 * strings. The server parses with these schemas and builds the exact contract arguments, so the
 * relayer can only ever call the gateway functions listed here.
 */
import { getAddress, type Address, type Hex } from "viem";
import { z } from "zod";
import type { Action, Auth, DeviceSig, Op, RegisterParams } from "./typed-data";

const hex = (bytes?: number) =>
  z.string().regex(bytes === undefined ? /^0x([0-9a-fA-F]{2})*$/ : new RegExp(`^0x[0-9a-fA-F]{${bytes * 2}}$`)).transform((v) => v.toLowerCase() as Hex);
const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/)
  .transform((v) => getAddress(v) as Address);
const uint = (max: bigint) =>
  z
    .string()
    .regex(/^\d{1,78}$/)
    .transform((v) => BigInt(v))
    .refine((v) => v <= max, "out of range");
const U64 = BigInt("18446744073709551615");
const U256 = (BigInt(1) << BigInt(256)) - BigInt(1);
const small = (max: number) => z.number().int().min(0).max(max);
const sigBytes = hex().refine((v) => v.length <= 2 + 2 * 1024, "signature too long");

const DeviceSigSchema = z.object({ keyType: small(2), key: hex().refine((v) => v.length <= 2 + 2 * 64), sig: sigBytes });
const AuthSchema = z.object({ signer: small(4), sig: sigBytes, device: DeviceSigSchema });
const ActionSchema = z.object({
  id: uint(U64),
  kind: small(9),
  account: address,
  keyType: small(2),
  keyHash: hex(32),
  scope: small(255),
  expiresAt: small(2 ** 40 - 1),
  flag: z.boolean(),
  opId: hex(32),
  deadline: uint(U256),
});
const OpSchema = z.object({
  id: uint(U64),
  kind: small(9),
  tier: small(4),
  account: address,
  keyType: small(2),
  keyHash: hex(32),
  scope: small(255),
  expiresAt: small(2 ** 40 - 1),
  flag: z.boolean(),
  nonce: uint(U64),
});
const KeyBytes = hex().refine((v) => v.length <= 2 + 2 * 64, "key too long");

export const RegisterPayloadSchema = z.object({
  params: z.object({
    owner: address,
    recovery: address,
    keyType: small(2),
    key: KeyBytes,
    scope: small(255),
    expiresAt: small(2 ** 40 - 1),
    deadline: uint(U256),
  }),
  signature: sigBytes,
});

export const ActionPayloadSchema = z.discriminatedUnion("fn", [
  z.object({ fn: z.literal("addKey"), action: ActionSchema, auth: AuthSchema, key: KeyBytes }),
  z.object({ fn: z.literal("suspendKey"), action: ActionSchema, auth: AuthSchema }),
  z.object({ fn: z.literal("retireKey"), action: ActionSchema, device: DeviceSigSchema }),
  z.object({ fn: z.literal("start"), action: ActionSchema, auth: AuthSchema, key: KeyBytes, consentSig: sigBytes }),
  z.object({ fn: z.literal("cancel"), action: ActionSchema, auth: AuthSchema, op: OpSchema }),
  z.object({ fn: z.literal("finalize"), op: OpSchema, key: KeyBytes }),
]);

export type RegisterPayload = z.output<typeof RegisterPayloadSchema>;
export type ActionPayload = z.output<typeof ActionPayloadSchema>;
export type ActionFn = ActionPayload["fn"];
export const ACTION_FNS: readonly ActionFn[] = ["addKey", "suspendKey", "retireKey", "start", "cancel", "finalize"];

/** Contract args for `register(params, ownerSig)`. */
export function registerArgs(p: RegisterPayload): [RegisterParams, Hex] {
  return [p.params, p.signature];
}

/** Contract function name and args for an action payload. */
export function actionCall(p: ActionPayload): { functionName: ActionFn; args: readonly unknown[] } {
  switch (p.fn) {
    case "addKey":
      return { functionName: "addKey", args: [p.action, p.auth, p.key] as [Action, Auth, Hex] };
    case "suspendKey":
      return { functionName: "suspendKey", args: [p.action, p.auth] as [Action, Auth] };
    case "retireKey":
      return { functionName: "retireKey", args: [p.action, p.device] as [Action, DeviceSig] };
    case "start":
      return { functionName: "start", args: [p.action, p.auth, p.key, p.consentSig] as [Action, Auth, Hex, Hex] };
    case "cancel":
      return { functionName: "cancel", args: [p.action, p.auth, p.op] as [Action, Auth, Op] };
    case "finalize":
      return { functionName: "finalize", args: [p.op, p.key] as [Op, Hex] };
  }
}

/** The Connect ID an action payload acts on. */
export function actionId(p: ActionPayload): bigint {
  return p.fn === "finalize" ? p.op.id : p.action.id;
}

/** Deadline of the signed action (finalize has none: it needs no signature). */
export function actionDeadline(p: ActionPayload): bigint | null {
  return p.fn === "finalize" ? null : p.action.deadline;
}

// ---------------------------------------------------------------- client-side serialization

type Jsonify<T> = T extends bigint ? string : T extends readonly (infer U)[] ? Jsonify<U>[] : T extends object ? { [K in keyof T]: Jsonify<T[K]> } : T;

/** bigint -> decimal string, recursively, for JSON bodies. */
export function toWire<T>(v: T): Jsonify<T> {
  return JSON.parse(JSON.stringify(v, (_k, x: unknown) => (typeof x === "bigint" ? x.toString() : x))) as Jsonify<T>;
}
