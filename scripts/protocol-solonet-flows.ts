/**
 * `npm run protocol:flows`: run the real Connect protocol flows against the Solonet dry-run deployment
 * (contracts/deployments/monad-testnet-dryrun-solonet.json) and report the gas Monad actually charges.
 *
 * Flows: register (relayer submits) · add a device instantly (owner + GUARD device) · start a delayed add and
 * cancel it from a device · start a delayed add and finalize it after the dev delay · change recovery on the
 * long (7-day in production) path and finalize it.
 *
 * Every tx uses gas limit = estimate × 1.10, because Monad charges the limit. Solonet only (chain 20143):
 * it can't warp time, so the dev build's short delays (20 s / 40 s) are real waits.
 *
 * Accounts: the relayer is the public anvil dev account (index DRYRUN_ACCOUNT_INDEX, default 7). The member's
 * owner/recovery/new-recovery wallets are further public anvil accounts (index 11-13). They only sign,
 * never pay. Device keys are fresh non-extractable WebCrypto P-256 keys, held in memory, as in the browser.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeAbiParameters,
  hashTypedData,
  http,
  keccak256,
  type Abi,
  type Address,
  type Hex,
  type TypedDataDomain,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";

const ROOT = path.resolve(__dirname, "..");
const C = path.join(ROOT, "contracts");
const RPC = process.env.SOLONET_RPC ?? "http://localhost:8080";
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const P256_N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const ALL = 63;
const MESSAGES = 31;

const solonet = defineChain({
  id: 20143,
  name: "Monad Solonet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const Kind = { TransferOwner: 1, ChangeRecovery: 2, AddKey: 3, RemoveKey: 4, UnsuspendKey: 5, RecoveryReset: 6, SuspendKey: 7, RetireKey: 8, Cancel: 9 } as const;
const Signer = { None: 0, Owner: 1, OwnerDevice: 2, Recovery: 3, Device: 4 } as const;

type Action = {
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
};
type Op = {
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
};

const ZERO_ADDR = "0x0000000000000000000000000000000000000000" as Address;
const ZERO32 = `0x${"0".repeat(64)}` as Hex;

// ---------------------------------------------------------------- devices (WebCrypto P-256)

type Device = { key: Hex; hash: Hex; priv: CryptoKey };

async function newDevice(): Promise<Device> {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", kp.publicKey)); // 0x04 || x || y
  const key = `0x${Buffer.from(raw.slice(1)).toString("hex")}` as Hex; // abi.encode(x, y) == x || y
  return { key, hash: keyHash(1, key), priv: kp.privateKey };
}

function keyHash(keyType: number, key: Hex): Hex {
  return keccak256(encodeAbiParameters([{ type: "uint8" }, { type: "bytes" }], [keyType, key]));
}

/** ECDSA P-256/SHA-256 over the 32-byte EIP-712 digest, normalized to low s (the contract rejects high s). */
async function deviceSign(d: Device, digest: Hex): Promise<Hex> {
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, d.priv, Buffer.from(digest.slice(2), "hex")));
  const r = BigInt(`0x${Buffer.from(sig.slice(0, 32)).toString("hex")}`);
  let s = BigInt(`0x${Buffer.from(sig.slice(32)).toString("hex")}`);
  if (s > P256_N / BigInt(2)) s = P256_N - s;
  return encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [r, s]);
}

// ---------------------------------------------------------------- main

async function main() {
  const dep = JSON.parse(readFileSync(path.join(C, "deployments/monad-testnet-dryrun-solonet.json"), "utf8")) as {
    chainId: number;
    gateway: Address;
    delaySeconds: number;
    longDelaySeconds: number;
  };
  if (dep.chainId !== 20143) throw new Error("flows run on Solonet (20143) only");
  const abi = (JSON.parse(readFileSync(path.join(C, "out/ConnectGateway.sol/ConnectGateway.json"), "utf8")) as { abi: Abi }).abi;

  const pub = createPublicClient({ chain: solonet, transport: http(RPC) });
  const chainId = await pub.getChainId();
  if (chainId !== 20143) throw new Error(`RPC is chain ${chainId}, expected Solonet 20143`);

  const relayer = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: Number(process.env.DRYRUN_ACCOUNT_INDEX ?? "7") });
  const owner = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 11 });
  const recovery = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 12 });
  const newRecovery = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: 13 });
  const wallet = createWalletClient({ account: relayer, chain: solonet, transport: http(RPC) });
  const gw = dep.gateway;
  const domain: TypedDataDomain = { name: "ConnectProtocol", version: "1", chainId, verifyingContract: gw };

  const rows: { step: string; used: bigint; limit: bigint; price: bigint }[] = [];

  async function send(step: string, functionName: string, args: unknown[]) {
    const est = await pub.estimateContractGas({ address: gw, abi, functionName, args, account: relayer });
    const gas = (est * BigInt(110)) / BigInt(100);
    const hash = await wallet.writeContract({ address: gw, abi, functionName, args, gas });
    const rc = await pub.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`${step} reverted`);
    rows.push({ step, used: rc.gasUsed, limit: gas, price: rc.effectiveGasPrice });
    console.log(`✓ ${step.padEnd(34)} est ${est} · limit ${gas} · used ${rc.gasUsed}`);
    return rc;
  }

  const read = <T>(functionName: string, args: unknown[] = []) =>
    pub.readContract({ address: gw, abi, functionName, args }) as Promise<T>;

  const actionTypes = {
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

  const now = async () => Number((await pub.getBlock()).timestamp);
  const action = async (id: bigint, kind: number, extra: Partial<Action> = {}): Promise<Action> => ({
    id,
    kind,
    account: ZERO_ADDR,
    keyType: 0,
    keyHash: ZERO32,
    scope: 0,
    expiresAt: 0,
    flag: false,
    opId: ZERO32,
    deadline: BigInt((await now()) + 3600),
    ...extra,
  });
  const message = async (a: Action) => ({ ...a, nonce: await read<bigint>("nonceOf", [a.id]) });
  const digestOf = async (a: Action) => hashTypedData({ domain, types: actionTypes, primaryType: "Action", message: await message(a) });
  const ownerSig = async (a: Action) => owner.signTypedData({ domain, types: actionTypes, primaryType: "Action", message: await message(a) });
  const noDevice = { keyType: 0, key: "0x" as Hex, sig: "0x" as Hex };
  const devSig = async (d: Device, a: Action) => ({ keyType: 1, key: d.key, sig: await deviceSign(d, await digestOf(a)) });
  const opOf = (a: Action, tier: number, nonce: bigint): Op => ({
    id: a.id, kind: a.kind, tier, account: a.account, keyType: a.keyType, keyHash: a.keyHash, scope: a.scope, expiresAt: a.expiresAt, flag: a.flag, nonce,
  });
  const waitUntil = async (t: number) => {
    while ((await now()) < t) await new Promise((r) => setTimeout(r, 1000));
  };

  console.log(`Solonet · gateway ${gw} · delays ${dep.delaySeconds}s / ${dep.longDelaySeconds}s (dev build) · relayer ${relayer.address}`);
  const phone = await newDevice();
  const laptop = await newDevice();
  const miniApp = await newDevice();
  const tablet = await newDevice();
  const expiresAt = (await now()) + 365 * 86400;

  // 1. register: the member's Mera wallet signs once; the relayer pays.
  const regNonce = await read<bigint>("registerNonce", [owner.address]);
  const reg = { owner: owner.address, recovery: recovery.address, keyType: 1, key: phone.key, scope: ALL, expiresAt, deadline: BigInt((await now()) + 3600) };
  const regSig = await owner.signTypedData({
    domain,
    types: {
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
    },
    primaryType: "Register",
    message: { owner: reg.owner, recovery: reg.recovery, keyType: 1, keyHash: phone.hash, scope: ALL, expiresAt, nonce: regNonce, deadline: reg.deadline },
  });
  const existing = await pub.readContract({
    address: (await read<Address>("idRegistry")),
    abi: [{ type: "function", name: "idOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint64" }] }],
    functionName: "idOf",
    args: [owner.address],
  });
  if (existing !== BigInt(0)) throw new Error(`owner already has ID ${existing} on this deployment; redeploy with npm run protocol:deploy -- --solonet`);
  await send("register (+1 device key)", "register", [reg, regSig]);
  const id = BigInt(1);

  // 2. instant add: owner + GUARD device (phone) add the laptop.
  let a = await action(id, Kind.AddKey, { keyType: 1, keyHash: laptop.hash, scope: ALL, expiresAt });
  await send("addKey instant (owner + device)", "addKey", [a, { signer: Signer.OwnerDevice, sig: await ownerSig(a), device: await devSig(phone, a) }, laptop.key]);

  // 3. delayed add (owner alone), cancelled from the laptop.
  a = await action(id, Kind.AddKey, { keyType: 1, keyHash: miniApp.hash, scope: MESSAGES, expiresAt });
  let nonce = await read<bigint>("nonceOf", [id]);
  await send("start delayed addKey (owner)", "start", [a, { signer: Signer.Owner, sig: await ownerSig(a), device: noDevice }, miniApp.key, "0x"]);
  const cancelled = opOf(a, Signer.Owner, nonce);
  const c = await action(id, Kind.Cancel, { opId: await read<Hex>("opIdOf", [cancelled]) });
  await send("cancel (device)", "cancel", [c, { signer: Signer.Device, sig: "0x", device: await devSig(laptop, c) }, cancelled]);

  // 4. delayed add (owner alone) + 5. change recovery on the long path (owner + device), then finalize both.
  a = await action(id, Kind.AddKey, { keyType: 1, keyHash: tablet.hash, scope: ALL, expiresAt });
  nonce = await read<bigint>("nonceOf", [id]);
  const addRc = await send("start delayed addKey (owner)", "start", [a, { signer: Signer.Owner, sig: await ownerSig(a), device: noDevice }, tablet.key, "0x"]);
  const addOp = opOf(a, Signer.Owner, nonce);
  const addStart = Number((await pub.getBlock({ blockNumber: addRc.blockNumber })).timestamp);

  a = await action(id, Kind.ChangeRecovery, { account: newRecovery.address });
  nonce = await read<bigint>("nonceOf", [id]);
  const recRc = await send("start changeRecovery (owner + device)", "start", [a, { signer: Signer.OwnerDevice, sig: await ownerSig(a), device: await devSig(phone, a) }, "0x", "0x"]);
  const recOp = opOf(a, Signer.OwnerDevice, nonce);
  const recStart = Number((await pub.getBlock({ blockNumber: recRc.blockNumber })).timestamp);

  console.log(`  waiting ${dep.delaySeconds}s (dev delay) …`);
  await waitUntil(addStart + dep.delaySeconds);
  await send("finalize delayed addKey (anyone)", "finalize", [addOp, tablet.key]);
  console.log(`  waiting for the long delay (${dep.longDelaySeconds}s) …`);
  await waitUntil(recStart + dep.longDelaySeconds);
  await send("finalize changeRecovery (anyone)", "finalize", [recOp, "0x"]);

  // checks
  const keysAddr = await read<Address>("keyRegistry");
  const canSign = (h: Hex) =>
    pub.readContract({
      address: keysAddr,
      abi: [{ type: "function", name: "canSign", stateMutability: "view", inputs: [{ type: "uint64" }, { type: "bytes32" }, { type: "uint8" }], outputs: [{ type: "bool" }] }],
      functionName: "canSign",
      args: [id, h, 1],
    });
  const ok = (await canSign(phone.hash)) && (await canSign(laptop.hash)) && (await canSign(tablet.hash)) && !(await canSign(miniApp.hash));
  if (!ok) throw new Error("unexpected key states after flows");
  console.log("✓ state: phone, laptop, tablet active; mini-app add cancelled; recovery changed");

  const baseFee = (await pub.getBlock()).baseFeePerGas ?? BigInt(0);
  console.log("\nstep | gas used | gas limit (charged) | MON at base fee");
  for (const r of rows) console.log(`${r.step} | ${r.used} | ${r.limit} | ${(Number(r.limit * baseFee) / 1e18).toFixed(5)}`);
  console.log(`base fee ${Number(baseFee) / 1e9} gwei`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
