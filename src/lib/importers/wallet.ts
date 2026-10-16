/**
 * Wallet starter packs: read-only checks of the member's shared EmpowerTours
 * Mera wallet on Monad (chain 143). Holding a pack's token or membership means
 * you played Hunt / joined TURBO; people who hold the same pack are suggested,
 * plus the channel that fits.
 *
 * Only `eth_call balanceOf(address)` — no logs, no transactions, no signing.
 * Uses MONAD_RPC_URL or the public https://rpc.monad.xyz. Tests inject a fake RPC.
 */
export const MONAD_CHAIN_ID = 143;
export const DEFAULT_MONAD_RPC = "https://rpc.monad.xyz";

export interface StarterPack {
  id: string;
  /** Which EmpowerTours app this pack comes from. */
  app: "Hunt" | "TURBO" | "EmpowerTours";
  label: { en: string; es: string };
  contract: `0x${string}`;
  /** Channel suggested to holders. */
  channelSlug: string;
}

/**
 * Mainnet contracts, from the Hunt repo (lib/hunt/collectibles.ts and README
 * "Related"); names confirmed with a read-only name() call on 2026-10-16.
 */
export const STARTER_PACKS: readonly StarterPack[] = [
  {
    id: "hunt_passport",
    app: "Hunt",
    label: { en: "EmpowerTours Passport holders", es: "Titulares del EmpowerTours Passport" },
    contract: "0x4d5533e29cf190131885dc7dbef22e31f4252410",
    channelSlug: "monad",
  },
  {
    id: "turbo_cohort",
    app: "TURBO",
    label: { en: "TURBO cohort members", es: "Miembros de la cohorte TURBO" },
    contract: "0x13a63A60b0E0104911e845a7e944646045C1558F",
    channelSlug: "monad",
  },
  {
    id: "tours_holders",
    app: "EmpowerTours",
    label: { en: "TOURS holders", es: "Titulares de TOURS" },
    contract: "0x45b76a127167fD7FC7Ed264ad490144300eCfcBF",
    channelSlug: "monad",
  },
];

export function getPack(id: string): StarterPack | undefined {
  return STARTER_PACKS.find((p) => p.id === id);
}

export type RpcCall = (method: string, params: unknown[]) => Promise<unknown>;

export class RpcUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RpcUnavailable";
  }
}

/** JSON-RPC over fetch, read-only methods only. */
export function httpRpc(url: string = process.env.MONAD_RPC_URL || DEFAULT_MONAD_RPC, fetcher: typeof fetch = fetch): RpcCall {
  const allowed = new Set(["eth_call", "eth_chainId", "eth_blockNumber"]);
  let id = 0;
  return async (method, params) => {
    if (!allowed.has(method)) throw new Error(`refusing non-read RPC method ${method}`);
    let res: Response;
    try {
      res = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new RpcUnavailable("network");
    }
    if (!res.ok) throw new RpcUnavailable(`http_${res.status}`);
    const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new RpcUnavailable(body.error.message ?? "rpc_error");
    return body.result;
  };
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

export function balanceOfData(owner: string): string {
  if (!ADDRESS.test(owner)) throw new RangeError(`not an address: ${owner}`);
  return `0x70a08231${owner.toLowerCase().slice(2).padStart(64, "0")}`;
}

export async function holdsPack(rpc: RpcCall, pack: StarterPack, owner: string): Promise<boolean> {
  const result = await rpc("eth_call", [{ to: pack.contract, data: balanceOfData(owner) }, "latest"]);
  if (typeof result !== "string" || !/^0x[0-9a-f]*$/i.test(result)) throw new RpcUnavailable("bad_result");
  return result.length > 2 && BigInt(result) > BigInt(0);
}

/** Which packs one wallet holds. An RPC failure for one pack does not hide the others. */
export async function packsHeldBy(rpc: RpcCall, owner: string, packs: readonly StarterPack[] = STARTER_PACKS): Promise<{ held: string[]; failed: string[] }> {
  const held: string[] = [];
  const failed: string[] = [];
  await Promise.all(
    packs.map(async (p) => {
      try {
        if (await holdsPack(rpc, p, owner)) held.push(p.id);
      } catch {
        failed.push(p.id);
      }
    }),
  );
  const order = (id: string) => packs.findIndex((p) => p.id === id);
  return { held: held.sort((a, b) => order(a) - order(b)), failed: failed.sort((a, b) => order(a) - order(b)) };
}

/** Run async work over items with a small concurrency cap (public RPCs rate-limit). */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** How long a cached pack check counts as fresh. */
export const PACK_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
/** At most this many other members are checked per run. */
export const MAX_MEMBERS_CHECKED = 200;
