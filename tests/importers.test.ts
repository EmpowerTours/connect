import { describe, expect, it } from "vitest";
import {
  FarcasterUnavailable,
  HubProvider,
  NeynarProvider,
  getFarcasterProvider,
  isOwnAccount,
  matchFarcasterFollowing,
  normalizeFarcasterUsername,
  type Fetcher,
} from "@/lib/importers/farcaster";
import { channelKey, filterDrafts, mergeReasons, parseReasons, userKey } from "@/lib/importers/suggestions";
import { STARTER_PACKS, balanceOfData, holdsPack, httpRpc, mapLimit, packsHeldBy, type RpcCall } from "@/lib/importers/wallet";
import { handleFromProfileLink, matchXFollowing, normalizeHandle, parseXFile, selfAccountMatchesProfile } from "@/lib/importers/x";

/** A fake fetch: routes by URL substring, records calls. No network. */
function fakeFetch(routes: Record<string, unknown | ((url: string) => unknown)>, status = 200) {
  const calls: { url: string; headers?: Record<string, string> }[] = [];
  const fetcher: Fetcher = async (url, init) => {
    calls.push({ url, headers: init?.headers });
    const hit = Object.keys(routes).find((k) => url.includes(k));
    if (!hit) return { ok: false, status: 404, text: async () => "" };
    const v = routes[hit];
    const body = typeof v === "function" ? (v as (u: string) => unknown)(url) : v;
    return { ok: status < 400, status, text: async () => (body === "" ? "" : JSON.stringify(body)) };
  };
  return { fetcher, calls };
}

const ME = "0x29458c602e3db4fc3b54ec2bbee26dbe64c7779f";
const userData = (username: string, display: string) => ({
  messages: [
    { data: { userDataBody: { type: "USER_DATA_TYPE_USERNAME", value: username } } },
    { data: { userDataBody: { type: "USER_DATA_TYPE_DISPLAY", value: display } } },
  ],
});
const verifications = (addrs: string[]) => ({ messages: addrs.map((address) => ({ data: { verificationAddAddressBody: { address, protocol: "PROTOCOL_ETHEREUM" } } })) });

describe("farcaster importer", () => {
  it("normalizes usernames", () => {
    expect(normalizeFarcasterUsername("@Ana")).toBe("ana");
    expect(normalizeFarcasterUsername("https://warpcast.com/ana.eth")).toBe("ana.eth");
    expect(normalizeFarcasterUsername("https://farcaster.xyz/dwr/0xabc")).toBe("dwr");
    expect(normalizeFarcasterUsername("not a name")).toBeNull();
  });

  it("hub: finds an account by username, reads verified addresses, pages through follows", async () => {
    const { fetcher, calls } = fakeFetch({
      "userNameProofByName?name=ana": { fid: 42, owner: "0x1111111111111111111111111111111111111111" },
      "userDataByFid": userData("ana", "Ana Ruiz"),
      "verificationsByFid": verifications([ME.toUpperCase().replace("0X", "0x"), "ExAqci8uUVKtqHqFW58fmwgMMY9PATfRGGyv6837j9Lx"]),
      "linksByFid": (url: string) =>
        url.includes("pageToken=p2")
          ? { messages: [{ data: { linkBody: { targetFid: 7 } } }, { data: { linkBody: { targetFid: 42 } } }], nextPageToken: "" }
          : { messages: [{ data: { linkBody: { targetFid: 5 } } }, { data: { linkBody: { targetFid: 7 } } }], nextPageToken: "p2" },
    });
    const hub = new HubProvider(fetcher, "https://hub.example");
    const acc = await hub.findByUsername("@ana");
    expect(acc).toEqual({ fid: 42, username: "ana", displayName: "Ana Ruiz", addresses: ["0x1111111111111111111111111111111111111111", ME] });
    expect(isOwnAccount(acc!, [ME])).toBe(true);
    expect(isOwnAccount(acc!, ["0x2222222222222222222222222222222222222222"])).toBe(false);
    expect(await hub.following(42, 100)).toEqual([5, 7]); // de-duplicated, self-follow dropped
    expect(calls.every((c) => c.url.startsWith("https://hub.example/v1/"))).toBe(true);
  });

  it("hub: custody lookup that answers with an empty body means not found", async () => {
    const { fetcher } = fakeFetch({ onChainIdRegistryEventByAddress: "" });
    expect(await new HubProvider(fetcher).findByAddresses([ME])).toEqual([]);
  });

  it("hub: errors become FarcasterUnavailable (no crash)", async () => {
    const { fetcher } = fakeFetch({ userNameProofByName: {} }, 503);
    await expect(new HubProvider(fetcher).findByUsername("ana")).rejects.toBeInstanceOf(FarcasterUnavailable);
    const down: Fetcher = async () => {
      throw new Error("offline");
    };
    await expect(new HubProvider(down).following(1, 10)).rejects.toThrow("network");
  });

  it("neynar: sends the key, maps custody + verified addresses, follows the cursor", async () => {
    const { fetcher, calls } = fakeFetch({
      "bulk-by-address": { [ME]: [{ fid: 9, username: "sofia", display_name: "Sofía", custody_address: "0x3333333333333333333333333333333333333333", verified_addresses: { eth_addresses: [ME] } }] },
      "following?fid=9&limit=100&cursor=c2": { users: [{ user: { fid: 12 } }], next: { cursor: null } },
      "following?fid=9": { users: [{ user: { fid: 11 } }, { user: { fid: 12 } }], next: { cursor: "c2" } },
    });
    const n = new NeynarProvider(fetcher, "test-key");
    const [acc] = await n.findByAddresses([ME]);
    expect(acc.fid).toBe(9);
    expect(acc.addresses).toContain(ME);
    expect(await n.following(9, 100)).toEqual([11, 12]);
    expect(calls[0].headers?.["x-api-key"]).toBe("test-key");
  });

  it("picks Neynar only when a key is set (no key = public hub, no paid API needed)", () => {
    const { fetcher } = fakeFetch({});
    expect(getFarcasterProvider({}, fetcher).name).toBe("hub");
    expect(getFarcasterProvider({ NEYNAR_API_KEY: "k" }, fetcher).name).toBe("neynar");
  });

  it("matches only members whose Farcaster link is verified", () => {
    const members = [
      { id: "u1", farcasterFid: 5, farcasterVerified: true, farcasterUsername: "bea" },
      { id: "u2", farcasterFid: 7, farcasterVerified: false, farcasterUsername: "impostor" },
      { id: "u3", farcasterFid: 99, farcasterVerified: true, farcasterUsername: "carl" },
    ];
    expect(matchFarcasterFollowing([5, 7], members)).toEqual([{ userId: "u1", username: "bea" }]);
  });
});

describe("x importer", () => {
  it("parses following.js (ids), account.js (self) and keeps handles when links carry them", () => {
    const following = `window.YTD.following.part0 = [
      { "following": { "accountId": "123", "userLink": "https://twitter.com/intent/user?user_id=123" } },
      { "following": { "accountId": "456", "userLink": "https://twitter.com/intent/user?user_id=456&screen_name=Bea_Pay" } },
      { "nope": {} }
    ]`;
    const account = `window.YTD.account.part0 = [ { "account": { "accountId": "999", "username": "Sofia_Marin_Pay" } } ]`;
    const p = parseXFile(account, parseXFile(following));
    expect(p.accountIds).toEqual(["123", "456"]);
    expect(p.handles).toEqual(["bea_pay"]);
    expect(p.self).toEqual({ accountId: "999", username: "sofia_marin_pay" });
    expect(p.skipped).toBe(1);
  });

  it("parses CSV with a header and plain lists", () => {
    const csv = 'name,username\n"Bea, Pay",@bea_pay\nCarl,https://x.com/carl_x\nBad,not a handle!';
    expect(parseXFile(csv).handles).toEqual(["bea_pay", "carl_x"]);
    expect(parseXFile("@ana\nx.com/bea\n\n").handles).toEqual(["ana", "bea"]);
  });

  it("matches handles to profile X links and ids to recorded account ids", () => {
    const members = [
      { id: "u1", linkX: "https://x.com/Bea_Pay", xAccountId: null },
      { id: "u2", linkX: "", xAccountId: "123" },
      { id: "u3", linkX: "https://x.com/someone_else", xAccountId: null },
    ];
    expect(matchXFollowing({ handles: ["bea_pay"], accountIds: ["123"] }, members)).toEqual([
      { userId: "u1", handle: "bea_pay", by: "handle" },
      { userId: "u2", handle: "123", by: "id" },
    ]);
  });

  it("records your own account id only when it matches your profile link", () => {
    expect(selfAccountMatchesProfile({ accountId: "1", username: "ana" }, "https://x.com/Ana")).toBe(true);
    expect(selfAccountMatchesProfile({ accountId: "1", username: "ana" }, "https://x.com/bea")).toBe(false);
    expect(selfAccountMatchesProfile({ accountId: "1", username: "ana" }, "")).toBe(false);
    expect(handleFromProfileLink("https://x.com/ana")).toBe("ana");
    expect(normalizeHandle("https://mobile.twitter.com/Ana?ref=1")).toBe("ana");
  });
});

describe("wallet starter packs", () => {
  const fakeRpc = (holders: Record<string, string[]>, fail: string[] = []): { rpc: RpcCall; calls: string[] } => {
    const calls: string[] = [];
    const rpc: RpcCall = async (method, params) => {
      calls.push(method);
      const [{ to, data }] = params as [{ to: string; data: string }];
      if (fail.includes(to.toLowerCase())) throw new Error("rate limited");
      const owner = `0x${data.slice(-40)}`;
      return (holders[to.toLowerCase()] ?? []).includes(owner) ? "0x" + "1".padStart(64, "0") : "0x" + "0".repeat(64);
    };
    return { rpc, calls };
  };

  it("encodes balanceOf calls", () => {
    expect(balanceOfData(ME)).toBe(`0x70a08231${"0".repeat(24)}${ME.slice(2)}`);
    expect(() => balanceOfData("0x123")).toThrow();
  });

  it("finds held packs with eth_call only, and keeps going when one contract fails", async () => {
    const [passport, turbo, tours] = STARTER_PACKS.map((p) => p.contract.toLowerCase());
    const { rpc, calls } = fakeRpc({ [passport]: [ME], [turbo]: [ME] }, [tours]);
    expect(await holdsPack(rpc, STARTER_PACKS[0], ME)).toBe(true);
    expect(await packsHeldBy(rpc, ME)).toEqual({ held: ["hunt_passport", "turbo_cohort"], failed: ["tours_holders"] });
    expect(new Set(calls)).toEqual(new Set(["eth_call"]));
  });

  it("the HTTP RPC refuses anything but reads", async () => {
    const rpc = httpRpc("https://rpc.example", (async () => new Response("{}")) as typeof fetch);
    await expect(rpc("eth_sendRawTransaction", ["0x"])).rejects.toThrow(/refusing/);
    await expect(rpc("eth_sendTransaction", [{}])).rejects.toThrow(/refusing/);
  });

  it("the HTTP RPC posts a JSON-RPC eth_call", async () => {
    let seen: { url: string; body: { method: string } } | null = null;
    const f = (async (url: string, init: RequestInit) => {
      seen = { url, body: JSON.parse(String(init.body)) };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" + "0".repeat(64) }));
    }) as unknown as typeof fetch;
    expect(await holdsPack(httpRpc("https://rpc.example", f), STARTER_PACKS[1], ME)).toBe(false);
    expect(seen!.url).toBe("https://rpc.example");
    expect(seen!.body.method).toBe("eth_call");
  });

  it("packs point at mainnet contracts and an existing channel slug", () => {
    for (const p of STARTER_PACKS) {
      expect(p.contract).toMatch(/^0x[0-9a-fA-F]{40}$/);
      expect(p.channelSlug).toBe("monad");
    }
  });

  it("mapLimit preserves order", async () => {
    expect(await mapLimit([3, 1, 2], 2, async (n) => n * 2)).toEqual([6, 2, 4]);
  });
});

describe("suggestions", () => {
  it("merges reasons without duplicates", () => {
    const a = { source: "x" as const, code: "x_follow" as const, detail: "bea" };
    const b = { source: "farcaster" as const, code: "fc_follow" as const, detail: "bea" };
    expect(mergeReasons(mergeReasons([a], a), b)).toEqual([a, b]);
    expect(parseReasons("not json")).toEqual([]);
    expect(parseReasons(JSON.stringify([a, { bogus: 1 }]))).toEqual([a]);
  });
  it("drops self, already-followed people and joined channels, and collapses duplicates", () => {
    const r = { source: "wallet" as const, code: "wallet_pack" as const, detail: "hunt_passport" };
    const out = filterDrafts(
      [
        { key: userKey("me"), targetUserId: "me", reason: r },
        { key: userKey("f"), targetUserId: "f", reason: r },
        { key: userKey("n"), targetUserId: "n", reason: r },
        { key: userKey("n"), targetUserId: "n", reason: r },
        { key: channelKey("c1"), channelId: "c1", reason: r },
        { key: channelKey("c2"), channelId: "c2", reason: r },
      ],
      { viewerId: "me", following: new Set(["f"]), joinedChannels: new Set(["c1"]) },
    );
    expect(out.map((d) => d.key)).toEqual(["user:n", "channel:c2"]);
  });
});
