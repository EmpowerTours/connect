"use client";
/**
 * Browser half of the Connect ID wiring (design section 15.5). The Mera passkey wallet signs
 * identity actions (EIP-712 messages only, one prompt each; never a transaction); this device's
 * non-extractable P-256 key co-signs or acts alone where the contract allows. The relayer is asked
 * to submit; if it declines, the member gets the exact calldata to send from any wallet they
 * choose (SelfSubmitNeeded), since the gateway ignores who submits.
 *
 * Reference for payload shapes: scripts/protocol-solonet-flows.ts.
 */
import { hashTypedData, type Address, type Hex, type LocalAccount } from "viem";
import { withPasskeySigner } from "../mera/client";
import { deviceKeySlot, generateDeviceKey, loadDeviceKey, saveDeviceKey, forgetDeviceKey, signDigestWithDevice, type DeviceKey } from "./device-key";
import { toWire, type ActionPayload, type RegisterPayload } from "./payloads";
import { selfSubmit, type SelfSubmit, type SignedCall } from "./self-submit";
import {
  DEVICE_KEY_LIFETIME,
  KeyType,
  Kind,
  NO_DEVICE,
  Scope,
  Signer,
  ZERO_ADDRESS,
  actionTypedData,
  emptyAction,
  opFromAction,
  protocolDomain,
  registerTypedData,
  type Action,
  type Auth,
  type Op,
  type RegisterParams,
} from "./typed-data";

export interface ClientConfig {
  chainId: number;
  chainName: string;
  gateway: Address;
  delaySeconds: number;
  longDelaySeconds: number;
  devBuild: boolean;
  sponsorship: boolean;
}

export interface MeKey {
  keyHash: Hex;
  keyType: number;
  scope: number;
  state: number;
  expiresAt: number;
  addedAt: number;
  canPost: boolean;
  guard: boolean;
  thisDevice: boolean;
}

export interface Me {
  chainId: number;
  wallet: Address;
  registered: boolean;
  registerNonce: string;
  paused: boolean;
  sponsored: "invite" | "verified" | null;
  connectId?: string;
  owner?: Address;
  recovery?: Address | null;
  nonce?: string;
  device?: { keyHash: Hex; nonce: string } | null;
  keys?: MeKey[];
}

export type SubmitResult = { txHash: Hex; status: "confirmed" | "pending"; connectId?: string };

/** The relayer declined; `call` is the signed request for the member to send from any wallet. */
export class SelfSubmitNeeded extends Error {
  constructor(
    public readonly reason: string,
    public readonly call: SelfSubmit,
  ) {
    super(reason);
    this.name = "SelfSubmitNeeded";
  }
}

const DEADLINE_SECONDS = 30 * 60;

async function getJson<T>(url: string): Promise<T | null> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 404) return null;
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "request failed");
  return body;
}

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { res, json };
}

/** Null while the feature flag is off. */
export function fetchProtocolConfig(): Promise<ClientConfig | null> {
  return getJson<ClientConfig>("/api/v1/protocol/config");
}

export function fetchMe(deviceHash?: Hex | null): Promise<Me | null> {
  return getJson<Me>(`/api/v1/protocol/me${deviceHash ? `?device=${deviceHash}` : ""}`);
}

export async function thisDeviceKey(cfg: ClientConfig, wallet: string): Promise<DeviceKey | null> {
  return loadDeviceKey(deviceKeySlot(cfg.chainId, cfg.gateway, wallet));
}

const nowSec = () => Math.floor(Date.now() / 1000);
const deadline = () => BigInt(nowSec() + DEADLINE_SECONDS);

/** Ask the relayer to submit; on a sponsorship refusal, hand back the signed call for self-submit. */
async function submit(cfg: ClientConfig, call: SignedCall): Promise<SubmitResult> {
  const url = call.kind === "register" ? "/api/v1/relay/register" : "/api/v1/relay/action";
  const { res, json } = await post(url, toWire(call.payload));
  if (res.ok) return { txHash: json.txHash as Hex, status: json.status as "confirmed" | "pending", connectId: json.connectId as string | undefined };
  if (json.selfPay === true) throw new SelfSubmitNeeded(String(json.error ?? "sponsored gas is not available"), selfSubmit(cfg.chainId, cfg.gateway, call));
  throw new Error(String(json.error ?? "the request failed"));
}

/**
 * Register a Connect ID: one passkey prompt signs the Register; this device's key becomes the
 * first GUARD key; optional recovery address. Design section 8.1.
 */
export async function registerConnectId(cfg: ClientConfig, me: Me, opts: { recovery?: Address | null } = {}): Promise<SubmitResult> {
  if (me.registered) throw new Error("You already have a Connect ID.");
  const slot = deviceKeySlot(cfg.chainId, cfg.gateway, me.wallet);
  let device = await loadDeviceKey(slot);
  if (!device) {
    device = await generateDeviceKey();
    await saveDeviceKey(slot, device); // saved first, so a lost response never strands the key
  }
  const params: RegisterParams = {
    owner: me.wallet,
    recovery: opts.recovery ?? ZERO_ADDRESS,
    keyType: KeyType.P256,
    key: device.key,
    scope: Scope.ALL,
    expiresAt: nowSec() + DEVICE_KEY_LIFETIME,
    deadline: deadline(),
  };
  const domain = protocolDomain(cfg.chainId, cfg.gateway);
  return withPasskeySigner(me.wallet, async (account) => {
    const signature = await account.signTypedData(registerTypedData(domain, params, BigInt(me.registerNonce)));
    const payload: RegisterPayload = { params, signature };
    return submit(cfg, { kind: "register", payload });
  });
}

function requireId(me: Me): bigint {
  if (!me.registered || !me.connectId) throw new Error("Register your Connect ID first.");
  return BigInt(me.connectId);
}

async function ownerAuth(cfg: ClientConfig, account: LocalAccount, a: Action, nonce: bigint, coSigner: DeviceKey | null): Promise<Auth> {
  const td = actionTypedData(protocolDomain(cfg.chainId, cfg.gateway), a, nonce);
  const sig = await account.signTypedData(td);
  if (!coSigner) return { signer: Signer.Owner, sig, device: NO_DEVICE };
  return { signer: Signer.OwnerDevice, sig, device: { keyType: KeyType.P256, key: coSigner.key, sig: await signDigestWithDevice(coSigner, hashTypedData(td)) } };
}

/**
 * Revoke THIS device: it retires its own key (no passkey needed; instant). History it signed
 * stays valid. The local key is deleted afterwards.
 */
export async function retireThisDevice(cfg: ClientConfig, me: Me): Promise<SubmitResult> {
  const id = requireId(me);
  const slot = deviceKeySlot(cfg.chainId, cfg.gateway, me.wallet);
  const device = await loadDeviceKey(slot);
  if (!device) throw new Error("This device has no Connect key.");
  const fresh = await fetchMe(device.hash);
  if (!fresh?.device) throw new Error("Could not read this device's key.");
  const a = emptyAction(id, Kind.RetireKey, deadline(), { keyType: KeyType.P256, keyHash: device.hash });
  const sig = await signDigestWithDevice(device, hashTypedData(actionTypedData(protocolDomain(cfg.chainId, cfg.gateway), a, BigInt(fresh.device.nonce))));
  const payload: ActionPayload = { fn: "retireKey", action: a, device: { keyType: KeyType.P256, key: device.key, sig } };
  const r = await submit(cfg, { kind: "action", payload });
  await forgetDeviceKey(slot);
  return r;
}

/** Suspend another key now (owner, co-signed by this device when it has one). Un-suspending takes 3 days. */
export async function suspendKey(cfg: ClientConfig, me: Me, keyHash: Hex): Promise<SubmitResult> {
  const id = requireId(me);
  const device = await thisDeviceKey(cfg, me.wallet);
  const a = emptyAction(id, Kind.SuspendKey, deadline(), { keyType: KeyType.P256, keyHash });
  return withPasskeySigner(me.wallet, async (account) => {
    const auth = await ownerAuth(cfg, account, a, BigInt(me.nonce ?? "0"), device && device.hash !== keyHash ? device : null);
    return submit(cfg, { kind: "action", payload: { fn: "suspendKey", action: a, auth } });
  });
}

export interface PendingOpRecord {
  op: Op;
  key: Hex;
  readyAt: number;
  label: string;
}

const PENDING_KEY = "connect.protocol.pending";

function pendingSlot(cfg: ClientConfig, wallet: string) {
  return `${PENDING_KEY}:${deviceKeySlot(cfg.chainId, cfg.gateway, wallet)}`;
}

export function pendingOps(cfg: ClientConfig, wallet: string): PendingOpRecord[] {
  try {
    const raw = localStorage.getItem(pendingSlot(cfg, wallet));
    if (!raw) return [];
    return (JSON.parse(raw) as (Omit<PendingOpRecord, "op"> & { op: Record<string, unknown> })[]).map((r) => ({
      ...r,
      op: { ...(r.op as unknown as Op), id: BigInt(r.op.id as string), nonce: BigInt(r.op.nonce as string) },
    }));
  } catch {
    return [];
  }
}

function savePending(cfg: ClientConfig, wallet: string, list: PendingOpRecord[]) {
  try {
    localStorage.setItem(pendingSlot(cfg, wallet), JSON.stringify(toWire(list)));
  } catch {
    /* storage unavailable: the op is still finalizable from its OpStarted event */
  }
}

/** Starts a delayed op and remembers it for finalizing, also when the member self-submits it. */
async function submitDelayed(cfg: ClientConfig, me: Me, call: SignedCall, rec: PendingOpRecord): Promise<SubmitResult> {
  const remember = () => savePending(cfg, me.wallet, [...pendingOps(cfg, me.wallet), rec]);
  try {
    const r = await submit(cfg, call);
    remember();
    return r;
  } catch (e) {
    if (e instanceof SelfSubmitNeeded) remember();
    throw e;
  }
}

/**
 * Remove a key (delayed 3 days, cancellable). Co-signed by this device when it has a GUARD key and
 * is not the target, so the target can't veto it (design section 5).
 */
export async function startRemoveKey(cfg: ClientConfig, me: Me, keyHash: Hex): Promise<SubmitResult> {
  const id = requireId(me);
  const device = await thisDeviceKey(cfg, me.wallet);
  const coSigner = device && device.hash !== keyHash ? device : null;
  const a = emptyAction(id, Kind.RemoveKey, deadline(), { keyType: KeyType.P256, keyHash });
  const nonce = BigInt(me.nonce ?? "0");
  return withPasskeySigner(me.wallet, async (account) => {
    const auth = await ownerAuth(cfg, account, a, nonce, coSigner);
    const rec = { op: opFromAction(a, auth.signer, nonce), key: "0x" as Hex, readyAt: nowSec() + cfg.delaySeconds, label: "remove key" };
    return submitDelayed(cfg, me, { kind: "action", payload: { fn: "start", action: a, auth, key: "0x", consentSig: "0x" } }, rec);
  });
}

/**
 * Add THIS device when it has no key yet and no other device can approve it: the owner starts a
 * delayed add (3 days), which every other device is told about and can cancel.
 */
export async function startAddThisDevice(cfg: ClientConfig, me: Me): Promise<SubmitResult> {
  const id = requireId(me);
  const slot = deviceKeySlot(cfg.chainId, cfg.gateway, me.wallet);
  let device = await loadDeviceKey(slot);
  if (!device) {
    device = await generateDeviceKey();
    await saveDeviceKey(slot, device);
  }
  const a = emptyAction(id, Kind.AddKey, deadline(), { keyType: KeyType.P256, keyHash: device.hash, scope: Scope.ALL, expiresAt: nowSec() + DEVICE_KEY_LIFETIME });
  const nonce = BigInt(me.nonce ?? "0");
  const key = device.key;
  return withPasskeySigner(me.wallet, async (account) => {
    const auth = await ownerAuth(cfg, account, a, nonce, null);
    const rec = { op: opFromAction(a, Signer.Owner, nonce), key, readyAt: nowSec() + cfg.delaySeconds, label: "add this device" };
    return submitDelayed(cfg, me, { kind: "action", payload: { fn: "start", action: a, auth, key, consentSig: "0x" } }, rec);
  });
}

/**
 * Instant add: the owner and THIS device's GUARD key co-sign a new key (for example a second key
 * generated on this device, or a key another device showed as a QR code).
 */
export async function addKeyInstant(cfg: ClientConfig, me: Me, newKey: { key: Hex; keyHash: Hex; scope: number; expiresAt: number }): Promise<SubmitResult> {
  const id = requireId(me);
  const device = await thisDeviceKey(cfg, me.wallet);
  if (!device) throw new Error("This device has no Connect key to approve with.");
  const a = emptyAction(id, Kind.AddKey, deadline(), { keyType: KeyType.P256, keyHash: newKey.keyHash, scope: newKey.scope, expiresAt: newKey.expiresAt });
  return withPasskeySigner(me.wallet, async (account) => {
    const auth = await ownerAuth(cfg, account, a, BigInt(me.nonce ?? "0"), device);
    return submit(cfg, { kind: "action", payload: { fn: "addKey", action: a, auth, key: newKey.key } });
  });
}

/** Finalize a delayed op once ready (anyone may; the relayer pays when it sponsors this member). */
export async function finalizeOp(cfg: ClientConfig, me: Me, rec: PendingOpRecord): Promise<SubmitResult> {
  const r = await submit(cfg, { kind: "action", payload: { fn: "finalize", op: rec.op, key: rec.key } });
  savePending(
    cfg,
    me.wallet,
    pendingOps(cfg, me.wallet).filter((p) => !(p.op.nonce === rec.op.nonce && p.op.kind === rec.op.kind && p.op.keyHash === rec.op.keyHash)),
  );
  return r;
}
