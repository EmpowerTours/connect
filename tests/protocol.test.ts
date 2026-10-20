import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashTypedData, keccak256, parseEther, parseGwei, toHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { CHAIN_SOLONET, CHAIN_TESTNET, PROTOCOL_CHAINS, ProtocolConfigError, gasLimitFromEstimate, protocolChainId, protocolRpcUrl } from "@/lib/protocol/chains";
import { loadDeployment, parseDeployment } from "@/lib/protocol/deployments";
import { P256_N, generateDeviceKey, keyBytesFromRawPublicKey, lowSSignature, signDigestWithDevice } from "@/lib/protocol/device-key";
import { checkProtocolEnv, checkRelayerServiceEnv, protocolEnabled, relayerForwardingEnabled } from "@/lib/protocol/env-check";
import { ACTION_FNS, ActionPayloadSchema, RegisterPayloadSchema, actionCall, toWire } from "@/lib/protocol/payloads";
import { RelayerKeyError, loadRelayerAccount, type KeyFs } from "@/lib/protocol/relayer/key";
import { MemoryRelayLedger } from "@/lib/protocol/relayer/ledger";
import { HARD_LIMITS, decide, relayerLimitsFromEnv, type RelayCounters, type RelayRequest } from "@/lib/protocol/relayer/policy";
import { Relayer, revertName, type RelayChain } from "@/lib/protocol/relayer/service";
import { selfSubmit, signedCallData } from "@/lib/protocol/self-submit";
import {
  KeyType,
  Kind,
  NO_DEVICE,
  Scope,
  Signer,
  ZERO32,
  ZERO_ADDRESS,
  actionTypedData,
  emptyAction,
  isValidScope,
  keyHashOf,
  opFromAction,
  opIdOf,
  protocolDomain,
  registerTypedData,
} from "@/lib/protocol/typed-data";

const ROOT = path.resolve(__dirname, "..");
const testnetJson = JSON.parse(readFileSync(path.join(ROOT, "deployments/monad-testnet.json"), "utf8")) as Record<string, unknown>;
// Public anvil dev keys (never real funds).
const DEV0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcc5edd38c1e2c4b5d" as const;
const DEV1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

describe("chain config", () => {
  it("defaults to testnet, allows Solonet, refuses mainnet and unknown chains", () => {
    expect(protocolChainId(undefined)).toBe(CHAIN_TESTNET);
    expect(protocolChainId("20143")).toBe(CHAIN_SOLONET);
    expect(() => protocolChainId("143")).toThrow(/mainnet/);
    expect(() => protocolChainId("1")).toThrow(ProtocolConfigError);
    expect(() => protocolChainId("abc")).toThrow(ProtocolConfigError);
  });
  it("RPC: per-chain default, override, https required for remote hosts", () => {
    expect(protocolRpcUrl(PROTOCOL_CHAINS[CHAIN_TESTNET], undefined)).toBe("https://rpc-testnet.monadinfra.com");
    expect(protocolRpcUrl(PROTOCOL_CHAINS[CHAIN_SOLONET], "")).toBe("http://localhost:8080");
    expect(protocolRpcUrl(PROTOCOL_CHAINS[CHAIN_TESTNET], "https://monad-testnet.drpc.org")).toBe("https://monad-testnet.drpc.org");
    expect(() => protocolRpcUrl(PROTOCOL_CHAINS[CHAIN_TESTNET], "http://rpc.example.com")).toThrow(/https/);
    expect(() => protocolRpcUrl(PROTOCOL_CHAINS[CHAIN_TESTNET], "ftp://x")).toThrow();
  });
  it("gas limit is estimate x 1.10 rounded up (Monad charges the limit)", () => {
    expect(gasLimitFromEstimate(BigInt(100000))).toBe(BigInt(110000));
    expect(gasLimitFromEstimate(BigInt(248909))).toBe(BigInt(273800));
    expect(gasLimitFromEstimate(BigInt(1))).toBe(BigInt(2));
  });
});

describe("deployments", () => {
  it("accepts the committed testnet record", () => {
    const d = parseDeployment(testnetJson, CHAIN_TESTNET);
    expect(d.gateway).toBe("0xA18079a087a12E53B39EAC6637508F534ddecB41");
    expect(d.fromBlock).toBe(BigInt(72551710));
    expect(d.devBuild).toBe(false);
  });
  it("refuses a chain mismatch, a dev build off Solonet, wrong testnet delays and a wrong domain", () => {
    expect(() => parseDeployment(testnetJson, CHAIN_SOLONET)).toThrow(/chain 10143/);
    expect(() => parseDeployment({ ...testnetJson, devBuild: true }, CHAIN_TESTNET)).toThrow(/dev build/);
    expect(() => parseDeployment({ ...testnetJson, delaySeconds: 20 }, CHAIN_TESTNET)).toThrow(/3-day/);
    expect(() => parseDeployment({ ...testnetJson, eip712Version: "2" }, CHAIN_TESTNET)).toThrow(/EIP-712/);
    expect(() => parseDeployment({ ...testnetJson, gateway: "0x123" }, CHAIN_TESTNET)).toThrow(/malformed/);
  });
  it("Solonet: dev builds allowed, flag must match the delays", () => {
    const solo = { ...testnetJson, chainId: CHAIN_SOLONET, devBuild: true, delaySeconds: 20, longDelaySeconds: 40 };
    expect(parseDeployment(solo, CHAIN_SOLONET).delaySeconds).toBe(20);
    expect(() => parseDeployment({ ...solo, devBuild: false }, CHAIN_SOLONET)).toThrow(/devBuild/);
  });
  it("loads by chain id from the default path or PROTOCOL_DEPLOYMENT_FILE", () => {
    const seen: string[] = [];
    const read = (f: string) => {
      seen.push(f);
      return JSON.stringify(testnetJson);
    };
    loadDeployment(CHAIN_TESTNET, {}, read);
    expect(seen[0].endsWith(path.join("deployments", "monad-testnet.json"))).toBe(true);
    loadDeployment(CHAIN_TESTNET, { PROTOCOL_DEPLOYMENT_FILE: "/tmp/x.json" }, read);
    expect(seen[1]).toBe("/tmp/x.json");
    expect(() => loadDeployment(CHAIN_TESTNET, {}, () => { throw new Error("ENOENT"); })).toThrow(/no deployment file/);
  });
});

describe("typed data", () => {
  const gw = "0x23252C400a7981F4BdB505D825d622Afe1F8B21e" as Address;
  it("type strings hash to the gateway's typehashes", () => {
    expect(keccak256(toHex("Register(address owner,address recovery,uint8 keyType,bytes32 keyHash,uint8 scope,uint40 expiresAt,uint256 nonce,uint256 deadline)"))).toBe(
      keccak256(toHex(`Register(${registerTypedData(protocolDomain(1, gw), { owner: gw, recovery: ZERO_ADDRESS, keyType: 1, key: "0x", scope: 63, expiresAt: 1, deadline: BigInt(1) }, BigInt(0)).types.Register.map((f) => `${f.type} ${f.name}`).join(",")})`)),
    );
    const a = actionTypedData(protocolDomain(1, gw), emptyAction(BigInt(1), Kind.Cancel, BigInt(1)), BigInt(0));
    expect(`Action(${a.types.Action.map((f) => `${f.type} ${f.name}`).join(",")})`).toBe(
      "Action(uint64 id,uint8 kind,address account,uint8 keyType,bytes32 keyHash,uint8 scope,uint40 expiresAt,bool flag,bytes32 opId,uint256 nonce,uint256 deadline)",
    );
  });
  it("op ids depend on every field; ops copy the action", () => {
    const a = emptyAction(BigInt(7), Kind.AddKey, BigInt(99), { keyType: 1, keyHash: keyHashOf(1, `0x${"11".repeat(64)}`), scope: 63, expiresAt: 5 });
    const op = opFromAction(a, Signer.Owner, BigInt(3));
    expect(op).toMatchObject({ id: BigInt(7), kind: Kind.AddKey, tier: Signer.Owner, nonce: BigInt(3), scope: 63 });
    expect(opIdOf(op)).not.toBe(opIdOf({ ...op, nonce: BigInt(4) }));
    expect(opIdOf(op)).toMatch(/^0x[0-9a-f]{64}$/);
  });
  it("scopes", () => {
    expect(isValidScope(Scope.ALL)).toBe(true);
    expect(isValidScope(0)).toBe(false);
    expect(isValidScope(64)).toBe(false);
  });
});

describe("device keys", () => {
  it("raw public key -> 64 key bytes; rejects compressed keys", () => {
    const raw = new Uint8Array(65);
    raw[0] = 4;
    raw.fill(0xab, 1);
    expect(keyBytesFromRawPublicKey(raw)).toBe(`0x${"ab".repeat(64)}`);
    expect(() => keyBytesFromRawPublicKey(new Uint8Array(33))).toThrow();
  });
  it("normalizes high s to low s", () => {
    const sig = new Uint8Array(64);
    sig[31] = 1;
    const highS = P256_N - BigInt(5);
    sig.set(Buffer.from(highS.toString(16).padStart(64, "0"), "hex"), 32);
    const enc = lowSSignature(sig);
    expect(BigInt(`0x${enc.slice(66)}`)).toBe(BigInt(5));
  });
  it("generates non-extractable keys and signs 32-byte digests with low s", async () => {
    const d = await generateDeviceKey();
    expect(d.privateKey.extractable).toBe(false);
    expect(d.key).toMatch(/^0x[0-9a-f]{128}$/);
    expect(d.hash).toBe(keyHashOf(KeyType.P256, d.key));
    for (let i = 0; i < 5; i++) {
      const sig = await signDigestWithDevice(d, keccak256(toHex(`m${i}`)));
      expect(BigInt(`0x${sig.slice(66)}`) <= P256_N / BigInt(2)).toBe(true);
    }
    await expect(signDigestWithDevice(d, "0x1234")).rejects.toThrow();
  });
});

describe("payload schemas", () => {
  const action = emptyAction(BigInt(1), Kind.SuspendKey, BigInt(100), { keyType: 1, keyHash: `0x${"aa".repeat(32)}` });
  const auth = { signer: Signer.Owner, sig: `0x${"11".repeat(65)}` as Hex, device: NO_DEVICE };
  it("round-trips bigints and only allows the listed gateway functions", () => {
    const p = ActionPayloadSchema.parse(toWire({ fn: "suspendKey", action, auth }));
    expect(p.fn === "suspendKey" && p.action.id).toBe(BigInt(1));
    expect(actionCall(p).functionName).toBe("suspendKey");
    expect(ACTION_FNS).not.toContain("pause");
    expect(ActionPayloadSchema.safeParse(toWire({ fn: "pause", action, auth })).success).toBe(false);
    expect(ActionPayloadSchema.safeParse(toWire({ fn: "renounceGuardian" })).success).toBe(false);
  });
  it("rejects malformed fields", () => {
    expect(ActionPayloadSchema.safeParse(toWire({ fn: "suspendKey", action: { ...action, keyHash: "0x12" }, auth })).success).toBe(false);
    expect(ActionPayloadSchema.safeParse({ ...toWire({ fn: "suspendKey", action, auth }), action: { ...toWire(action), id: "-1" } }).success).toBe(false);
    expect(RegisterPayloadSchema.safeParse({ params: {}, signature: "0x" }).success).toBe(false);
  });
});

describe("relayer limits", () => {
  it("defaults to the approved values", () => {
    const { limits, errors } = relayerLimitsFromEnv({});
    expect(errors).toEqual([]);
    expect(limits.balanceCapWei).toBe(parseEther("100"));
    expect(limits.dailyCapWei).toBe(parseEther("50"));
    expect(limits.accountTxPerDay).toBe(10);
    expect(limits.ipSignupsPerDay).toBe(3);
    expect(limits.inviterSignupsPerDay).toBe(20);
    expect(limits.registrationsPerAccount).toBe(1);
  });
  it("can be lowered, never raised", () => {
    expect(relayerLimitsFromEnv({ RELAYER_DAILY_CAP_MON: "10" }).limits.dailyCapWei).toBe(parseEther("10"));
    expect(relayerLimitsFromEnv({ RELAYER_DAILY_CAP_MON: "51" }).errors[0]).toMatch(/approved maximum/);
    expect(relayerLimitsFromEnv({ RELAYER_BALANCE_CAP_MON: "1000" }).errors.length).toBe(1);
    expect(relayerLimitsFromEnv({ RELAYER_IP_SIGNUPS_PER_DAY: "5" }).errors.length).toBe(1);
    expect(relayerLimitsFromEnv({ RELAYER_ACCOUNT_TX_PER_DAY: "2.5" }).errors.length).toBe(1);
    expect(relayerLimitsFromEnv({ RELAYER_MAX_GAS_PRICE_GWEI: "5000" }).errors.length).toBe(1);
  });
});

describe("relayer policy", () => {
  const limits = relayerLimitsFromEnv({}).limits;
  const zero: RelayCounters = { accountRegistrations: 0, accountTxToday: 0, ipSignupsToday: 0, inviterSignupsToday: 0, spentTodayWei: BigInt(0) };
  const req = (over: Partial<RelayRequest> = {}): RelayRequest => ({
    type: "register",
    eligibility: { source: "verified" },
    costWei: parseEther("0.03"),
    maxFeePerGasWei: parseGwei("102"),
    relayerBalanceWei: parseEther("38"),
    ...over,
  });
  const code = (r: RelayRequest, c: Partial<RelayCounters> = {}) => {
    const d = decide(r, { ...zero, ...c }, limits);
    return d.ok ? "ok" : d.code;
  };
  it("sponsors an eligible first registration", () => {
    expect(code(req())).toBe("ok");
    expect(code(req({ eligibility: { source: "invite", inviterId: "u1" } }))).toBe("ok");
  });
  it("needs an invite or a verification", () => {
    expect(code(req({ eligibility: null }))).toBe("not_eligible");
    expect(code(req({ type: "action", eligibility: null }))).toBe("not_eligible");
  });
  it("1 sponsored registration per account", () => {
    expect(code(req(), { accountRegistrations: 1 })).toBe("already_sponsored");
    expect(code(req({ type: "action" }), { accountRegistrations: 1 })).toBe("ok");
  });
  it("10 sponsored transactions per account per day", () => {
    expect(code(req({ type: "action" }), { accountTxToday: 9 })).toBe("ok");
    expect(code(req({ type: "action" }), { accountTxToday: 10 })).toBe("account_daily_limit");
  });
  it("3 verified signups per IP per day; invite signups exempt but 20 per inviter", () => {
    expect(code(req(), { ipSignupsToday: 2 })).toBe("ok");
    expect(code(req(), { ipSignupsToday: 3 })).toBe("ip_limit");
    const inv = req({ eligibility: { source: "invite", inviterId: "u1" } });
    expect(code(inv, { ipSignupsToday: 50 })).toBe("ok");
    expect(code(inv, { inviterSignupsToday: 19 })).toBe("ok");
    expect(code(inv, { inviterSignupsToday: 20 })).toBe("inviter_limit");
  });
  it("money: daily cap, balance cap, low balance, per-tx cost and gas price", () => {
    expect(code(req(), { spentTodayWei: parseEther("49.98") })).toBe("daily_cap");
    expect(code(req(), { spentTodayWei: parseEther("49.97") })).toBe("ok");
    expect(code(req({ relayerBalanceWei: parseEther("100.01") }))).toBe("over_funded");
    expect(code(req({ relayerBalanceWei: parseEther("0.01") }))).toBe("relayer_low_balance");
    expect(code(req({ costWei: parseEther("0.6") }))).toBe("tx_too_expensive");
    expect(code(req({ maxFeePerGasWei: parseGwei("300") }))).toBe("gas_price_too_high");
  });
  it("money rules apply even to eligible accounts and before eligibility", () => {
    expect(code(req({ eligibility: null, relayerBalanceWei: parseEther("101") }))).toBe("over_funded");
    expect(HARD_LIMITS.dailyCapMon).toBe(50);
  });
});

describe("relayer key", () => {
  const fs = (mode: number, content = DEV0): KeyFs => ({ read: () => content, mode: () => mode });
  it("reads RELAYER_KEY and exposes only an account", () => {
    const a = loadRelayerAccount({ RELAYER_KEY: DEV0 }, fs(0o600), "/repo");
    expect(a.address).toBe(privateKeyToAccount(DEV0).address);
  });
  it("RELAYER_KEY_FILE must be absolute, outside the repo, and 0600", () => {
    expect(loadRelayerAccount({ RELAYER_KEY_FILE: "/home/box/.connect/relayer.key" }, fs(0o100600), "/repo").address).toBe(privateKeyToAccount(DEV0).address);
    expect(() => loadRelayerAccount({ RELAYER_KEY_FILE: "relayer.key" }, fs(0o600), "/repo")).toThrow(/absolute/);
    expect(() => loadRelayerAccount({ RELAYER_KEY_FILE: "/repo/secrets/relayer.key" }, fs(0o600), "/repo")).toThrow(/outside the repository/);
    expect(() => loadRelayerAccount({ RELAYER_KEY_FILE: "/k" }, fs(0o644), "/repo")).toThrow(/chmod 600/);
    expect(() => loadRelayerAccount({ RELAYER_KEY_FILE: "/k" }, { read: () => "", mode: () => { throw new Error("ENOENT"); } }, "/repo")).toThrow(/does not exist/);
  });
  it("rejects both sources, none, or a malformed key, without echoing it", () => {
    expect(() => loadRelayerAccount({ RELAYER_KEY: DEV0, RELAYER_KEY_FILE: "/k" }, fs(0o600), "/repo")).toThrow(/not both/);
    expect(() => loadRelayerAccount({}, fs(0o600), "/repo")).toThrow(RelayerKeyError);
    try {
      loadRelayerAccount({ RELAYER_KEY: "0xdeadbeefdeadbeef" }, fs(0o600), "/repo");
    } catch (e) {
      expect(String(e)).not.toContain("deadbeef");
    }
  });
});

describe("feature flag and boot checks", () => {
  const read = () => JSON.stringify(testnetJson);
  const TOKEN = "t".repeat(40);
  it("off by default: no errors, nothing loaded", () => {
    expect(protocolEnabled({})).toBe(false);
    expect(relayerForwardingEnabled({ RELAYER_URL: "https://r", RELAYER_SERVICE_TOKEN: TOKEN })).toBe(false);
    expect(checkProtocolEnv({}, { read: () => { throw new Error("must not read"); } })).toEqual({ errors: [], warnings: [] });
    expect(checkProtocolEnv({ RELAYER_URL: "https://r" }).warnings.length).toBe(1);
  });
  it("web app: validates chain and deployment; never holds the relayer key", () => {
    expect(checkProtocolEnv({ PROTOCOL_ENABLED: "1" }, { read }).errors).toEqual([]);
    expect(checkProtocolEnv({ PROTOCOL_ENABLED: "1", PROTOCOL_CHAIN_ID: "143" }, { read }).errors[0]).toMatch(/mainnet/);
    expect(checkProtocolEnv({ PROTOCOL_ENABLED: "1", PROTOCOL_CHAIN_ID: "20143", NODE_ENV: "production" }, { read: () => JSON.stringify({ ...testnetJson, chainId: 20143 }) }).errors.join()).toMatch(/Solonet/);
    expect(checkProtocolEnv({ RELAYER_KEY: DEV1 }).errors.join()).toMatch(/must not be set on the web app/);
    expect(checkProtocolEnv({ PROTOCOL_ENABLED: "1", RELAYER_KEY_FILE: "/k" }, { read }).errors.join()).toMatch(/must not be set on the web app/);
  });
  it("web app: relayer URL must be https or Railway-private, with a long token", () => {
    const base = { PROTOCOL_ENABLED: "1", RELAYER_SERVICE_TOKEN: TOKEN };
    expect(checkProtocolEnv({ ...base, RELAYER_URL: "http://connect-relayer.railway.internal:8080" }, { read }).errors).toEqual([]);
    expect(relayerForwardingEnabled({ ...base, RELAYER_URL: "http://connect-relayer.railway.internal:8080" })).toBe(true);
    expect(checkProtocolEnv({ ...base, RELAYER_URL: "http://relayer.example.com" }, { read }).errors.join()).toMatch(/https/);
    expect(checkProtocolEnv({ PROTOCOL_ENABLED: "1", RELAYER_URL: "https://r.example.com", RELAYER_SERVICE_TOKEN: "short" }, { read }).errors.join()).toMatch(/RELAYER_SERVICE_TOKEN/);
  });
  it("relayer service: key, token, database, limits, and not the guardian", () => {
    const keyFs: KeyFs = { read: () => DEV1, mode: () => 0o600 };
    const ok = { PROTOCOL_ENABLED: "1", RELAYER_KEY: DEV1, RELAYER_SERVICE_TOKEN: TOKEN, DATABASE_URL: "postgresql://x" };
    const good = checkRelayerServiceEnv(ok, { read, keyFs });
    expect(good.errors).toEqual([]);
    expect(good.address).toBe(privateKeyToAccount(DEV1).address);
    expect(checkRelayerServiceEnv({ ...ok, RELAYER_KEY: undefined }, { read, keyFs }).errors.join()).toMatch(/RELAYER_KEY/);
    expect(checkRelayerServiceEnv({ ...ok, RELAYER_SERVICE_TOKEN: "x" }, { read, keyFs }).errors.join()).toMatch(/TOKEN/);
    expect(checkRelayerServiceEnv({ ...ok, DATABASE_URL: "" }, { read, keyFs }).errors.join()).toMatch(/DATABASE_URL/);
    expect(checkRelayerServiceEnv({ ...ok, RELAYER_DAILY_CAP_MON: "500" }, { read, keyFs }).errors.join()).toMatch(/approved maximum/);
    expect(checkRelayerServiceEnv({ ...ok, PROTOCOL_ENABLED: "" }, { read, keyFs }).errors.join()).toMatch(/PROTOCOL_ENABLED/);
    const guardianIsDev1 = () => JSON.stringify({ ...testnetJson, guardian: privateKeyToAccount(DEV1).address });
    expect(checkRelayerServiceEnv(ok, { read: guardianIsDev1, keyFs }).errors.join()).toMatch(/guardian/);
  });
});

// ---------------------------------------------------------------- relayer service with a fake chain

function fakeChain(over: Partial<RelayChain> = {}, ids: Record<string, bigint> = {}): RelayChain & { sent: string[] } {
  const sent: string[] = [];
  return {
    chainId: CHAIN_TESTNET,
    relayer: privateKeyToAccount(DEV1).address,
    sent,
    simulate: async () => undefined,
    estimateGas: async () => BigInt(250000),
    fees: async () => ({ maxFeePerGas: parseGwei("102"), maxPriorityFeePerGas: parseGwei("2") }),
    balance: async () => parseEther("38"),
    send: async (fn) => {
      sent.push(fn);
      return `0x${String(sent.length).padStart(64, "0")}` as Hex;
    },
    receipt: async () => ({ status: "success", gasUsed: BigInt(275000), effectiveGasPrice: parseGwei("102"), registeredId: BigInt(42) }),
    idOf: async (o) => ids[o.toLowerCase()] ?? BigInt(0),
    ...over,
  };
}

const owner = privateKeyToAccount(DEV0);
const gw = "0x23252C400a7981F4BdB505D825d622Afe1F8B21e" as Address;
const quiet = { info: () => undefined, warn: () => undefined, error: () => undefined };
const nowDate = new Date("2026-10-18T10:00:00Z");
const nowSec = Math.floor(nowDate.getTime() / 1000);

async function regPayload(over: Partial<{ scope: number; deadline: bigint; owner: Address }> = {}) {
  const d = await generateDeviceKey();
  const params = { owner: over.owner ?? owner.address, recovery: ZERO_ADDRESS, keyType: 1, key: d.key, scope: over.scope ?? Scope.ALL, expiresAt: nowSec + 1000, deadline: over.deadline ?? BigInt(nowSec + 600) };
  const signature = await owner.signTypedData(registerTypedData(protocolDomain(CHAIN_TESTNET, gw), params, BigInt(0)));
  return RegisterPayloadSchema.parse(toWire({ params, signature }));
}

describe("relayer service", () => {
  const limits = relayerLimitsFromEnv({}).limits;
  const user = { id: "u1", wallet: owner.address.toLowerCase() };
  const mk = (chain: RelayChain, ledger = new MemoryRelayLedger()) => ({ ledger, relayer: new Relayer(chain, ledger, limits, quiet, gw, () => nowDate) });

  it("sponsors, charges gas limit x price, and records the new ID", async () => {
    const chain = fakeChain();
    const { relayer, ledger } = mk(chain);
    const r = await relayer.relayRegister(user, { source: "verified" }, "ip", await regPayload());
    expect(r).toMatchObject({ ok: true, status: "confirmed", connectId: "42" });
    expect(chain.sent).toEqual(["register"]);
    expect(ledger.rows[0].gasLimit).toBe(BigInt(275000)); // 250k x 1.10
    expect(ledger.rows[0].costWei).toBe(BigInt(275000) * parseGwei("102"));
    expect(ledger.rows[0].connectId).toBe("42");
  });
  it("checks the payload before spending anything", async () => {
    const chain = fakeChain();
    const { relayer } = mk(chain);
    expect((await relayer.relayRegister(user, { source: "verified" }, "ip", await regPayload({ scope: Scope.POST }))).ok).toBe(false);
    expect((await relayer.relayRegister(user, { source: "verified" }, "ip", await regPayload({ deadline: BigInt(nowSec - 1) }))).ok).toBe(false);
    expect((await relayer.relayRegister(user, { source: "verified" }, "ip", await regPayload({ deadline: BigInt(nowSec + 3 * 3600) }))).ok).toBe(false);
    const other = await regPayload({ owner: privateKeyToAccount(DEV1).address });
    expect(await relayer.relayRegister(user, { source: "verified" }, "ip", other)).toMatchObject({ ok: false, code: "not_your_id" });
    expect(chain.sent).toEqual([]);
  });
  it("a call that would revert is never sent or reserved", async () => {
    const chain = fakeChain({ simulate: async () => { throw Object.assign(new Error("x"), { cause: { data: { errorName: "BadSignature" } } }); } });
    const { relayer, ledger } = mk(chain);
    const r = await relayer.relayRegister(user, { source: "verified" }, "ip", await regPayload());
    expect(r).toMatchObject({ ok: false, code: "simulation_failed" });
    expect(!r.ok && r.reason).toContain("BadSignature");
    expect(chain.sent).toEqual([]);
    expect(ledger.rows).toEqual([]);
  });
  it("refusals offer self-pay and send nothing", async () => {
    const chain = fakeChain();
    const { relayer } = mk(chain);
    expect(await relayer.relayRegister(user, null, "ip", await regPayload())).toMatchObject({ ok: false, code: "not_eligible", selfPay: true, status: 402 });
    expect(chain.sent).toEqual([]);
  });
  it("a failed send releases the reservation; a revert keeps the charge", async () => {
    const failing = fakeChain({ send: async () => { throw new Error("nonce too low"); } });
    const a = mk(failing);
    expect(await a.relayer.relayRegister(user, { source: "verified" }, "ip", await regPayload())).toMatchObject({ ok: false, code: "send_failed" });
    expect(a.ledger.rows[0]).toMatchObject({ status: "failed", costWei: BigInt(0) });
    // The released reservation doesn't use up the account's one sponsored registration.
    const ok = mk(fakeChain(), a.ledger);
    expect((await ok.relayer.relayRegister(user, { source: "verified" }, "ip", await regPayload())).ok).toBe(true);

    const reverting = fakeChain({ receipt: async () => ({ status: "reverted", gasUsed: BigInt(275000), effectiveGasPrice: parseGwei("102"), registeredId: null }) });
    const b = mk(reverting);
    expect(await b.relayer.relayRegister(user, { source: "verified" }, "ip", await regPayload())).toMatchObject({ ok: false, code: "reverted" });
    expect(b.ledger.rows[0].status).toBe("reverted");
    expect(b.ledger.rows[0].costWei > BigInt(0)).toBe(true);
  });
  it("a missing receipt leaves the worst-case reservation counted", async () => {
    const chain = fakeChain({ receipt: async () => null });
    const { relayer, ledger } = mk(chain);
    expect(await relayer.relayRegister(user, { source: "verified" }, "ip", await regPayload())).toMatchObject({ ok: true, status: "pending" });
    expect(ledger.rows[0]).toMatchObject({ status: "sent" });
    expect(ledger.rows[0].costWei).toBe(BigInt(275000) * parseGwei("102"));
  });
  it("actions: only on the member's own ID, and only after registering", async () => {
    const chain = fakeChain({}, { [owner.address.toLowerCase()]: BigInt(5) });
    const { relayer } = mk(chain);
    const mineAction = emptyAction(BigInt(5), Kind.SuspendKey, BigInt(nowSec + 600), { keyType: 1, keyHash: `0x${"aa".repeat(32)}` });
    const sig = await owner.signTypedData(actionTypedData(protocolDomain(CHAIN_TESTNET, gw), mineAction, BigInt(0)));
    const p = ActionPayloadSchema.parse(toWire({ fn: "suspendKey", action: mineAction, auth: { signer: Signer.Owner, sig, device: NO_DEVICE } }));
    expect((await relayer.relayAction(user, { source: "verified" }, null, p)).ok).toBe(true);
    const other = ActionPayloadSchema.parse(toWire({ fn: "suspendKey", action: { ...mineAction, id: BigInt(6) }, auth: { signer: Signer.Owner, sig, device: NO_DEVICE } }));
    expect(await relayer.relayAction(user, { source: "verified" }, null, other)).toMatchObject({ ok: false, code: "not_your_id" });
    const noId = mk(fakeChain());
    expect(await noId.relayer.relayAction(user, { source: "verified" }, null, p)).toMatchObject({ ok: false, code: "no_connect_id" });
  });
  it("serializes submissions so concurrent requests can't both pass a cap", async () => {
    const chain = fakeChain();
    const ledger = new MemoryRelayLedger();
    const relayer = new Relayer(chain, ledger, { ...limits, dailyCapWei: BigInt(275000) * parseGwei("102") }, quiet, gw, () => nowDate);
    const users = ["a", "b", "c"].map((id) => ({ id, wallet: owner.address.toLowerCase() }));
    const results = await Promise.all(users.map(async (u) => relayer.relayRegister(u, { source: "verified" }, `ip-${u.id}`, await regPayload())));
    expect(results.filter((r) => r.ok).length).toBe(1);
    expect(results.filter((r) => !r.ok && r.code === "daily_cap").length).toBe(2);
  });
  it("revertName finds custom errors", () => {
    expect(revertName({ cause: { cause: { data: { errorName: "NotReady" } } } })).toBe("NotReady");
    expect(revertName(new Error("boom\nstack"))).toBe("boom");
  });
});

describe("self-submit", () => {
  it("encodes exactly the gateway call carrying the member's signatures", async () => {
    const p = await regPayload();
    const c = selfSubmit(CHAIN_TESTNET, gw, { kind: "register", payload: p });
    expect(c).toMatchObject({ chainId: CHAIN_TESTNET, to: gw, value: "0" });
    expect(c.data).toBe(signedCallData({ kind: "register", payload: p }));
    expect(c.data.slice(0, 10)).toMatch(/^0x[0-9a-f]{8}$/);
    expect(signedCallData({ kind: "register", payload: await regPayload() })).not.toBe(c.data);
    expect(hashTypedData(registerTypedData(protocolDomain(CHAIN_TESTNET, gw), p.params, BigInt(0)))).toMatch(/^0x/);
    expect(ZERO32).toHaveLength(66);
  });
});

describe("transaction code stays out of the web app", () => {
  // Complements tests/ecosystem-wallet.test.ts: the only sender is the relayer service, and it
  // never touches the shared Mera key code.
  it("the relayer service doesn't import Mera key handling", async () => {
    const { readdirSync } = await import("node:fs");
    const dir = path.join(ROOT, "relayer");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".ts"))) {
      const src = readFileSync(path.join(dir, f), "utf8");
      expect(src, f).not.toMatch(/lib\/mera|@category-labs\/mera|withPasskeySigner/);
    }
  });
});
