/**
 * `npm run protocol:wiring-e2e`: end-to-end run of the app wiring against local Monad Solonet,
 * using the dry-run deployment (contracts/deployments/monad-testnet-dryrun-solonet.json).
 *
 * It drives the real app modules (chain config, deployment loader, typed data, payload schemas,
 * device keys, reader, relayer service + policy, viem relay chain, self-pay calldata), not copies.
 * Only the ledger is in memory instead of Postgres.
 *
 * Accounts: public anvil dev accounts only (test mnemonic). Relayer = index 8 (not the dry-run
 * deployer/guardian, index 7). Members = the first unregistered indexes from 20 up. Device keys are
 * fresh non-extractable WebCrypto P-256 keys. Refuses any chain but 20143.
 *
 * Then a READ-ONLY check of the committed testnet deployment (no transactions).
 */
import {
  createPublicClient,
  createWalletClient,
  hashTypedData,
  http,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mnemonicToAccount, type HDAccount } from "viem/accounts";
import { gatewayAbi } from "../src/lib/protocol/abi";
import { CHAIN_SOLONET, CHAIN_TESTNET, PROTOCOL_CHAINS, protocolRpcUrl, viemChain } from "../src/lib/protocol/chains";
import { loadDeployment } from "../src/lib/protocol/deployments";
import { generateDeviceKey, signDigestWithDevice, type DeviceKey } from "../src/lib/protocol/device-key";
import { ActionPayloadSchema, RegisterPayloadSchema, toWire, type ActionPayload, type RegisterPayload } from "../src/lib/protocol/payloads";
import { ProtocolReader } from "../src/lib/protocol/reader";
import { viemRelayChain } from "../relayer/chain-viem";
import { MemoryRelayLedger } from "../src/lib/protocol/relayer/ledger";
import { HARD_LIMITS, relayerLimitsFromEnv, type Eligibility, type RelayerLimits } from "../src/lib/protocol/relayer/policy";
import { Relayer, type RelayResult } from "../src/lib/protocol/relayer/service";
import { selfSubmit } from "../src/lib/protocol/self-submit";
import {
  DEVICE_KEY_LIFETIME,
  KeyState,
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
} from "../src/lib/protocol/typed-data";

const MNEMONIC = "test test test test test test test test test test test junk";
const dev = (i: number) => mnemonicToAccount(MNEMONIC, { addressIndex: i });

let passed = 0;
function check(cond: unknown, what: string): asserts cond {
  if (!cond) throw new Error(`FAILED: ${what}`);
  passed++;
  console.log(`✓ ${what}`);
}
const fail = (r: RelayResult) => (r.ok ? "ok" : `${r.code}: ${r.reason}`);

async function main() {
  // ---------------------------------------------------------------- config (the app's own loaders)
  const chain = PROTOCOL_CHAINS[CHAIN_SOLONET];
  const rpc = protocolRpcUrl(chain, process.env.SOLONET_RPC);
  const d = loadDeployment(CHAIN_SOLONET, {});
  const vchain = viemChain(chain, rpc);
  const client = createPublicClient({ chain: vchain, transport: http(rpc) }) as PublicClient;
  check((await client.getChainId()) === CHAIN_SOLONET, "RPC is Solonet 20143");
  const reader = new ProtocolReader(client, d);
  check((await reader.verifyDeployment()).length === 0, "dry-run deployment matches the chain (registries, dev build)");

  const relayerAcct = dev(8);
  check(relayerAcct.address.toLowerCase() !== d.guardian.toLowerCase(), "relayer is not the deployer/guardian");
  const relayChain = viemRelayChain(client, vchain, rpc, relayerAcct, d);
  const ledger = new MemoryRelayLedger();
  const approved = relayerLimitsFromEnv({}).limits;
  // Solonet dev accounts hold ~1e20 MON, far above the 100 MON cap; only the balance cap is lifted here
  // (the real cap is exercised below and in the unit tests). Every other limit is the approved value.
  const limits: RelayerLimits = { ...approved, balanceCapWei: parseEther("1000000000000000000000") };
  const quiet = { info: () => undefined, warn: (m: string) => console.log(`  [warn] ${m}`), error: (m: string) => console.log(`  [alert] ${m}`) };
  const relayer = new Relayer(relayChain, ledger, limits, quiet, d.gateway);
  const domain = protocolDomain(CHAIN_SOLONET, d.gateway);

  // Members: first unregistered dev accounts from index 20.
  const members: HDAccount[] = [];
  for (let i = 20; members.length < 8 && i < 400; i++) {
    const a = dev(i);
    if ((await reader.idOf(a.address)) === BigInt(0)) members.push(a);
  }
  check(members.length === 8, `found 8 unregistered public dev accounts (from index ${20})`);
  const [alice, bob, carol, dan, v1, v2, v3, v4] = members;
  const invite: Eligibility = { source: "invite", inviterId: "inviter-1" };
  const verified: Eligibility = { source: "verified" };
  const now = async () => Number((await client.getBlock()).timestamp);
  const deadline = async () => BigInt((await now()) + 1800);

  async function registerPayload(owner: HDAccount, device: DeviceKey, recovery: Address = ZERO_ADDRESS): Promise<RegisterPayload> {
    const params = { owner: owner.address, recovery, keyType: KeyType.P256, key: device.key, scope: Scope.ALL, expiresAt: (await now()) + DEVICE_KEY_LIFETIME, deadline: await deadline() };
    const td = registerTypedData(domain, params, await reader.registerNonce(owner.address));
    const signature = await owner.signTypedData(td);
    // Round-trip through the wire schema exactly as the API route does.
    return RegisterPayloadSchema.parse(toWire({ params, signature }));
  }
  const wire = (p: ActionPayload) => ActionPayloadSchema.parse(toWire(p));
  async function ownerAuth(owner: HDAccount, a: Action, nonce: bigint, device?: DeviceKey): Promise<Auth> {
    const td = actionTypedData(domain, a, nonce);
    const sig = await owner.signTypedData(td);
    if (!device) return { signer: Signer.Owner, sig, device: NO_DEVICE };
    return { signer: Signer.OwnerDevice, sig, device: { keyType: KeyType.P256, key: device.key, sig: await signDigestWithDevice(device, hashTypedData(td)) } };
  }

  // ---------------------------------------------------------------- 1. sponsored registration (invite)
  const phone = await generateDeviceKey();
  const regP = await registerPayload(alice, phone, carol.address);
  const onchainDigest = await client.readContract({ address: d.gateway, abi: gatewayAbi, functionName: "registerDigest", args: [regP.params, await reader.registerNonce(alice.address)] });
  check(onchainDigest === hashTypedData(registerTypedData(domain, regP.params, await reader.registerNonce(alice.address))), "Register digest from the app's typed data equals the gateway's registerDigest");
  const userA = { id: "user-alice", wallet: alice.address.toLowerCase() };
  let r = await relayer.relayRegister(userA, invite, "ip-1", regP);
  check(r.ok && r.status === "confirmed" && r.connectId, `sponsored register (invite) confirmed: ${fail(r)}`);
  const idA = BigInt((r as { connectId: string }).connectId);
  check((await reader.idOf(alice.address)) === idA, `chain read: idOf(alice) = ${idA}`);
  const ident = await reader.identity(idA);
  check(ident.owner === alice.address && ident.recovery === carol.address, "chain read: owner and recovery match");
  const k = await reader.key(idA, phone.hash);
  check(k && k.state === KeyState.Active && k.guard && k.canPost, "chain read: phone key active with GUARD");
  const regRow = ledger.rows.find((x) => x.type === "register" && x.userId === userA.id);
  check(regRow && regRow.status === "confirmed" && regRow.gasLimit > BigInt(0), `ledger: register charged at gas limit ${regRow?.gasLimit} (estimate x1.10)`);

  // ---------------------------------------------------------------- 2. policy refusals
  // Same Connect account, now linked to another wallet: still only one sponsored registration.
  r = await relayer.relayRegister({ id: userA.id, wallet: bob.address.toLowerCase() }, invite, "ip-1", await registerPayload(bob, await generateDeviceKey()));
  check(!r.ok && r.code === "already_sponsored" && r.selfPay, "second sponsored registration for the same account refused (self-pay offered)");
  r = await relayer.relayRegister({ id: "user-bob", wallet: bob.address.toLowerCase() }, null, "ip-9", await registerPayload(bob, await generateDeviceKey()));
  check(!r.ok && r.code === "not_eligible" && r.selfPay, "no invite and no verification: refused, self-pay offered");
  r = await relayer.relayRegister({ id: "user-bob", wallet: bob.address.toLowerCase() }, verified, "ip-9", await registerPayload(alice, await generateDeviceKey()));
  check(!r.ok && r.code === "not_your_id", "registering someone else's wallet refused");

  // IP limit: 3 verified signups per IP per day, the 4th refused; an invite signup from the same IP is exempt.
  const vs = [v1, v2, v3];
  for (const [i, v] of vs.entries()) {
    r = await relayer.relayRegister({ id: `user-v${i}`, wallet: v.address.toLowerCase() }, verified, "ip-shared", await registerPayload(v, await generateDeviceKey()));
    check(r.ok, `verified signup ${i + 1}/3 from one IP sponsored`);
  }
  r = await relayer.relayRegister({ id: "user-v4", wallet: v4.address.toLowerCase() }, verified, "ip-shared", await registerPayload(v4, await generateDeviceKey()));
  check(!r.ok && r.code === "ip_limit", "4th verified signup from the same IP refused (ip_limit)");

  // ---------------------------------------------------------------- 3. self-submit: the refused member's signed call, sent by another wallet
  // The gateway ignores msg.sender, so a refused member can send the identical signed request from any
  // wallet (here public dev account 9); the member's Mera wallet (v4) holds no MON and signs no transaction.
  check((await client.getBalance({ address: v4.address })) === BigInt(0), "refused member's own wallet holds 0 MON");
  const spP = await registerPayload(v4, await generateDeviceKey());
  const call = selfSubmit(CHAIN_SOLONET, d.gateway, { kind: "register", payload: spP });
  const submitter = createWalletClient({ account: dev(9), chain: vchain, transport: http(rpc) });
  const gasEst = await client.estimateGas({ account: dev(9).address, to: call.to, data: call.data });
  const spHash = await submitter.sendTransaction({ to: call.to, data: call.data, gas: (gasEst * BigInt(110) + BigInt(99)) / BigInt(100) });
  const spRc = await client.waitForTransactionReceipt({ hash: spHash });
  check(spRc.status === "success" && (await reader.idOf(v4.address)) > BigInt(0), "self-submit: another wallet sent the member's signed register; the ID belongs to the member");
  check((await reader.identityOf(v4.address))?.owner === v4.address, "self-submitted ID is owned by the member's wallet, not the submitter");

  // ---------------------------------------------------------------- 4. device keys through the gateway (relayed)
  const laptop = await generateDeviceKey();
  const tablet = await generateDeviceKey();
  const exp = (await now()) + DEVICE_KEY_LIFETIME;
  const id = idA;
  let a = emptyAction(id, Kind.AddKey, await deadline(), { keyType: KeyType.P256, keyHash: laptop.hash, scope: Scope.ALL, expiresAt: exp });
  let nonce = (await reader.identity(id)).nonce;
  const addDigest = await client.readContract({ address: d.gateway, abi: gatewayAbi, functionName: "actionDigest", args: [a, nonce] });
  check(addDigest === hashTypedData(actionTypedData(domain, a, nonce)), "Action digest from the app's typed data equals the gateway's actionDigest");
  r = await relayer.relayAction(userA, invite, "ip-1", wire({ fn: "addKey", action: a, auth: await ownerAuth(alice, a, nonce, phone), key: laptop.key }));
  check(r.ok, `instant add (owner + phone) of laptop: ${fail(r)}`);
  check((await reader.key(id, laptop.hash))?.state === KeyState.Active, "chain read: laptop active");

  a = emptyAction(id, Kind.SuspendKey, await deadline(), { keyType: KeyType.P256, keyHash: laptop.hash });
  nonce = (await reader.identity(id)).nonce;
  r = await relayer.relayAction(userA, invite, "ip-1", wire({ fn: "suspendKey", action: a, auth: await ownerAuth(alice, a, nonce, phone) }));
  check(r.ok && (await reader.key(id, laptop.hash))?.state === KeyState.Suspended, `suspend laptop (instant): ${fail(r)}`);

  // Delayed remove of the laptop (owner + phone, so the laptop can't veto) and delayed add of a tablet (owner alone).
  a = emptyAction(id, Kind.RemoveKey, await deadline(), { keyType: KeyType.P256, keyHash: laptop.hash });
  nonce = (await reader.identity(id)).nonce;
  const rmAuth = await ownerAuth(alice, a, nonce, phone);
  r = await relayer.relayAction(userA, invite, "ip-1", wire({ fn: "start", action: a, auth: rmAuth, key: "0x", consentSig: "0x" }));
  check(r.ok, `start delayed remove of laptop (owner + phone): ${fail(r)}`);
  const rmOp = opFromAction(a, Signer.OwnerDevice, nonce);
  const rmStart = await now();

  a = emptyAction(id, Kind.AddKey, await deadline(), { keyType: KeyType.P256, keyHash: tablet.hash, scope: Scope.ALL, expiresAt: exp });
  nonce = (await reader.identity(id)).nonce;
  r = await relayer.relayAction(userA, invite, "ip-1", wire({ fn: "start", action: a, auth: await ownerAuth(alice, a, nonce), key: tablet.key, consentSig: "0x" }));
  check(r.ok, `start delayed add of tablet (owner alone): ${fail(r)}`);
  const addOp = opFromAction(a, Signer.Owner, nonce);

  // Early finalize is caught by simulation and never paid for.
  const before = ledger.rows.length;
  r = await relayer.relayAction(userA, invite, "ip-1", wire({ fn: "finalize", op: addOp, key: tablet.key }));
  check(!r.ok && r.code === "simulation_failed" && r.reason.includes("NotReady") && ledger.rows.length === before, "finalize before the delay: refused by simulation (NotReady), nothing reserved");

  // Bob (no Connect ID of this one) can't get actions on Alice's ID sponsored.
  r = await relayer.relayAction({ id: "user-v0", wallet: v1.address.toLowerCase() }, verified, "ip-x", wire({ fn: "finalize", op: addOp, key: tablet.key }));
  check(!r.ok && r.code === "not_your_id", "sponsoring an action on someone else's ID refused");

  console.log(`  waiting ${d.delaySeconds}s (Solonet dev delay) …`);
  while ((await now()) < rmStart + d.delaySeconds + 1) await new Promise((res) => setTimeout(res, 1000));
  r = await relayer.relayAction(userA, invite, "ip-1", wire({ fn: "finalize", op: rmOp, key: "0x" }));
  check(r.ok && (await reader.key(id, laptop.hash))?.state === KeyState.Removed, `finalize remove: laptop removed (${fail(r)})`);
  r = await relayer.relayAction(userA, invite, "ip-1", wire({ fn: "finalize", op: addOp, key: tablet.key }));
  check(r.ok && (await reader.key(id, tablet.hash))?.state === KeyState.Active, `finalize add: tablet active (${fail(r)})`);

  // Tablet revokes itself (device alone, its own nonce; no owner signature).
  a = emptyAction(id, Kind.RetireKey, await deadline(), { keyType: KeyType.P256, keyHash: tablet.hash });
  const dn = await reader.deviceNonce(id, tablet.hash);
  const sig = await signDigestWithDevice(tablet, hashTypedData(actionTypedData(domain, a, dn)));
  r = await relayer.relayAction(userA, invite, "ip-1", wire({ fn: "retireKey", action: a, device: { keyType: KeyType.P256, key: tablet.key, sig } }));
  check(r.ok && (await reader.key(id, tablet.hash))?.state === KeyState.Retired, `tablet retired itself: ${fail(r)}`);

  // Key listing from the ledger + chain.
  const hashes = await ledger.keyHashesFor(CHAIN_SOLONET, id.toString(), alice.address.toLowerCase());
  const keys = await reader.keys(id, hashes as Hex[]);
  check(keys.length === 3 && keys.map((x) => x.state).join(",") === `${KeyState.Active},${KeyState.Removed},${KeyState.Retired}`, "key list (ledger hashes + chain state): phone active, laptop removed, tablet retired");

  // ---------------------------------------------------------------- 5. per-account daily limit (10 sponsored tx/day)
  const today = ledger.rows.filter((x) => x.userId === userA.id && x.status !== "failed").length;
  check(today === 8, `ledger counted ${today} sponsored transactions for alice today`);
  for (let i = today; i < HARD_LIMITS.accountTxPerDay; i++) {
    const x = await generateDeviceKey();
    a = emptyAction(id, Kind.AddKey, await deadline(), { keyType: KeyType.P256, keyHash: x.hash, scope: Scope.POST, expiresAt: exp });
    nonce = (await reader.identity(id)).nonce;
    r = await relayer.relayAction(userA, invite, "ip-1", wire({ fn: "addKey", action: a, auth: await ownerAuth(alice, a, nonce, phone), key: x.key }));
    if (!r.ok) throw new Error(fail(r));
  }
  const x = await generateDeviceKey();
  a = emptyAction(id, Kind.AddKey, await deadline(), { keyType: KeyType.P256, keyHash: x.hash, scope: Scope.POST, expiresAt: exp });
  nonce = (await reader.identity(id)).nonce;
  r = await relayer.relayAction(userA, invite, "ip-1", wire({ fn: "addKey", action: a, auth: await ownerAuth(alice, a, nonce, phone), key: x.key }));
  check(!r.ok && r.code === "account_daily_limit" && r.selfPay, "11th sponsored transaction in a day refused (account_daily_limit)");

  // ---------------------------------------------------------------- 6. money caps against the real chain
  const strict = new Relayer(relayChain, new MemoryRelayLedger(), approved, quiet, d.gateway);
  const dP = await registerPayload(dan, await generateDeviceKey());
  r = await strict.relayRegister({ id: "user-dan", wallet: dan.address.toLowerCase() }, invite, "ip-d", dP);
  check(!r.ok && r.code === "over_funded", "approved 100 MON balance cap: a relayer holding more refuses (over_funded)");
  const tinyDaily = new Relayer(relayChain, new MemoryRelayLedger(), { ...limits, dailyCapWei: parseEther("0.001") }, quiet, d.gateway);
  r = await tinyDaily.relayRegister({ id: "user-dan", wallet: dan.address.toLowerCase() }, invite, "ip-d", dP);
  check(!r.ok && r.code === "daily_cap", "daily spend cap enforced before sending (daily_cap)");
  check((await reader.idOf(dan.address)) === BigInt(0), "nothing was sent for the refused requests");

  // ---------------------------------------------------------------- 7. read-only testnet check (no transactions)
  try {
    const t = PROTOCOL_CHAINS[CHAIN_TESTNET];
    const trpc = protocolRpcUrl(t, process.env.TESTNET_RPC);
    const td = loadDeployment(CHAIN_TESTNET, {});
    const tclient = createPublicClient({ chain: viemChain(t, trpc), transport: http(trpc, { timeout: 15_000 }) }) as PublicClient;
    const problems = await new ProtocolReader(tclient, td).verifyDeployment();
    check(problems.length === 0, `testnet ${td.gateway}: deployment file matches chain 10143 (read-only)${problems.length ? ` ${problems.join("; ")}` : ""}`);
    const delays = await Promise.all([
      tclient.readContract({ address: td.gateway, abi: gatewayAbi, functionName: "delay" }),
      tclient.readContract({ address: td.gateway, abi: gatewayAbi, functionName: "longDelay" }),
    ]);
    check(delays[0] === BigInt(259200) && delays[1] === BigInt(604800), "testnet gateway delays are 3 and 7 days");
  } catch (e) {
    console.log(`! testnet read-only check skipped: ${e instanceof Error ? e.message.split("\n")[0] : e}`);
  }

  const spent = await ledger.spentSince(CHAIN_SOLONET, new Date(Date.now() - 86_400_000));
  console.log(`\n${passed} checks passed · relayer spent ${(Number(spent) / 1e18).toFixed(4)} MON on Solonet across ${ledger.rows.filter((r) => r.status === "confirmed").length} sponsored tx`);
  for (const row of ledger.rows.filter((r) => r.status === "confirmed")) console.log(`  ${row.fn.padEnd(10)} gas limit ${row.gasLimit} · ${(Number(row.costWei) / 1e18).toFixed(5)} MON`);
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
