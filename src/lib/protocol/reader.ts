/**
 * Read Connect IDs and device keys from chain (the source of truth). Server-only.
 * Key listing uses the key hashes the app already knows (its relay ledger plus the
 * device's own key); a full event indexer is a later step (design section 15.3).
 */
import type { Address, Hex, PublicClient } from "viem";
import { gatewayAbi, idRegistryAbi, keyRegistryAbi } from "./abi";
import type { ProtocolDeployment } from "./deployments";
import { KeyState, Scope } from "./typed-data";

export interface ChainKey {
  keyHash: Hex;
  keyType: number;
  scope: number;
  /** Effective state (a key from before a recovery reset reports Suspended). */
  state: number;
  expiresAt: number;
  addedAt: number;
  current: boolean;
  canPost: boolean;
  guard: boolean;
}

export interface ChainIdentity {
  id: bigint;
  owner: Address;
  recovery: Address | null;
  nonce: bigint;
  recoveryNonce: bigint;
}

export class ProtocolReader {
  constructor(
    private readonly client: PublicClient,
    private readonly d: ProtocolDeployment,
  ) {}

  /** 0n when the address has no Connect ID. */
  idOf(owner: Address): Promise<bigint> {
    return this.client.readContract({ address: this.d.idRegistry, abi: idRegistryAbi, functionName: "idOf", args: [owner] });
  }

  async identityOf(owner: Address): Promise<ChainIdentity | null> {
    const id = await this.idOf(owner);
    if (id === BigInt(0)) return null;
    return this.identity(id);
  }

  async identity(id: bigint): Promise<ChainIdentity> {
    const [record, nonce, recoveryNonce] = await Promise.all([
      this.client.readContract({ address: this.d.idRegistry, abi: idRegistryAbi, functionName: "recordOf", args: [id] }),
      this.client.readContract({ address: this.d.gateway, abi: gatewayAbi, functionName: "nonceOf", args: [id] }),
      this.client.readContract({ address: this.d.gateway, abi: gatewayAbi, functionName: "recoveryNonceOf", args: [id] }),
    ]);
    const [owner, recovery] = record as readonly [Address, Address];
    return {
      id,
      owner,
      recovery: /^0x0{40}$/i.test(recovery) ? null : recovery,
      nonce: BigInt(nonce),
      recoveryNonce: BigInt(recoveryNonce),
    };
  }

  registerNonce(owner: Address): Promise<bigint> {
    return this.client.readContract({ address: this.d.gateway, abi: gatewayAbi, functionName: "registerNonce", args: [owner] });
  }

  async deviceNonce(id: bigint, keyHash: Hex): Promise<bigint> {
    return BigInt(await this.client.readContract({ address: this.d.gateway, abi: gatewayAbi, functionName: "deviceNonceOf", args: [id, keyHash] }));
  }

  paused(): Promise<boolean> {
    return this.client.readContract({ address: this.d.gateway, abi: gatewayAbi, functionName: "paused" });
  }

  /** Null for a hash never registered under this ID. */
  async key(id: bigint, keyHash: Hex): Promise<ChainKey | null> {
    const [rec, state, canPost, guard] = await Promise.all([
      this.client.readContract({ address: this.d.keyRegistry, abi: keyRegistryAbi, functionName: "keyOf", args: [id, keyHash] }),
      this.client.readContract({ address: this.d.keyRegistry, abi: keyRegistryAbi, functionName: "stateOf", args: [id, keyHash] }),
      this.client.readContract({ address: this.d.keyRegistry, abi: keyRegistryAbi, functionName: "canSign", args: [id, keyHash, Scope.POST] }),
      this.client.readContract({ address: this.d.keyRegistry, abi: keyRegistryAbi, functionName: "hasGuardPower", args: [id, keyHash] }),
    ]);
    const [k, current] = rec as unknown as readonly [{ keyType: number; scope: number; state: number; expiresAt: number; addedAt: number }, boolean];
    if (Number(state) === KeyState.None) return null;
    return {
      keyHash,
      keyType: Number(k.keyType),
      scope: Number(k.scope),
      state: Number(state),
      expiresAt: Number(k.expiresAt),
      addedAt: Number(k.addedAt),
      current,
      canPost,
      guard,
    };
  }

  async keys(id: bigint, hashes: Iterable<Hex>): Promise<ChainKey[]> {
    const unique = [...new Set([...hashes].map((h) => h.toLowerCase() as Hex))];
    const out = await Promise.all(unique.map((h) => this.key(id, h)));
    return out.filter((k): k is ChainKey => k !== null).sort((a, b) => a.addedAt - b.addedAt);
  }

  /** Confirms the deployment file matches what is on chain (code present, same registries, dev flag). */
  async verifyDeployment(): Promise<string[]> {
    const problems: string[] = [];
    const code = await this.client.getCode({ address: this.d.gateway });
    if (!code || code === "0x") return [`no contract at gateway ${this.d.gateway}`];
    const [ids, keys, dev, chainId] = await Promise.all([
      this.client.readContract({ address: this.d.gateway, abi: gatewayAbi, functionName: "idRegistry" }),
      this.client.readContract({ address: this.d.gateway, abi: gatewayAbi, functionName: "keyRegistry" }),
      this.client.readContract({ address: this.d.gateway, abi: gatewayAbi, functionName: "isDevBuild" }),
      this.client.getChainId(),
    ]);
    if (chainId !== this.d.chainId) problems.push(`RPC is chain ${chainId}, expected ${this.d.chainId}`);
    if (String(ids).toLowerCase() !== this.d.idRegistry.toLowerCase()) problems.push("idRegistry does not match the gateway");
    if (String(keys).toLowerCase() !== this.d.keyRegistry.toLowerCase()) problems.push("keyRegistry does not match the gateway");
    if (dev !== this.d.devBuild) problems.push(`gateway isDevBuild=${dev}, deployment says ${this.d.devBuild}`);
    return problems;
  }
}
