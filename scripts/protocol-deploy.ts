/**
 * `npm run protocol:deploy`: deploy the Connect protocol contracts to Monad TESTNET (10143). Never mainnet.
 *
 *   npm run protocol:deploy -- --solonet     dry run on local Monad Solonet (20143, default RPC http://localhost:8080)
 *   npm run protocol:deploy -- --fork        dry run on a local anvil fork of testnet
 *   npm run protocol:deploy -- --broadcast   REAL testnet deploy (the user runs this; refuses if underfunded)
 *
 * Keys: --broadcast reads the deployer key from DEPLOYER_KEY_FILE (default /home/box/.connect/deployer.key,
 * chmod 600, outside the repo), passes it to forge via env only and never prints it. --solonet and --fork
 * use the public anvil dev account (test mnemonic, index DRYRUN_ACCOUNT_INDEX, default 7), which forge
 * derives itself; it holds no real value.
 *
 * Monad charges the gas LIMIT, not gas used, so forge's estimate multiplier is kept at 1.10 (GAS_MULT=110).
 * Chain 143 is refused here, in the forge script and (for short delays) in the gateway constructor.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { mnemonicToAccount, privateKeyToAccount } from "viem/accounts";

const ROOT = path.resolve(__dirname, "..");
const C = path.join(ROOT, "contracts");
const FOUNDRY = process.env.FOUNDRY_BIN ?? path.join(process.env.HOME ?? "", ".foundry/bin");
const ANVIL_MNEMONIC = "test test test test test test test test test test test junk";
const TESTNET_RPC = process.env.TESTNET_RPC ?? "https://testnet-rpc.monad.xyz";
const MULT = process.env.GAS_MULT ?? "110";

type Mode = "solonet" | "fork" | "broadcast";
const has = (f: string) => process.argv.includes(f);
const MODE: Mode = has("--broadcast") ? "broadcast" : has("--fork") ? "fork" : "solonet";

async function rpcCall<T>(url: string, method: string, params: unknown[] = []): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = (await r.json()) as { result?: T; error?: { message: string } };
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result as T;
}

function readKeyFile(file: string): `0x${string}` {
  const k = readFileSync(file, "utf8").trim();
  return (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;
}

const mon = (gas: bigint, price: bigint) => (Number(gas * price) / 1e18).toFixed(4);

async function main() {
  let rpc: string;
  let expected: number;
  let anvil: ChildProcess | undefined;
  const env: NodeJS.ProcessEnv = { ...process.env };
  let deployer: string;

  if (MODE === "broadcast") {
    const pk = readKeyFile(process.env.DEPLOYER_KEY_FILE ?? "/home/box/.connect/deployer.key");
    env.DEPLOYER_PK = pk;
    deployer = privateKeyToAccount(pk).address;
    rpc = TESTNET_RPC;
    expected = 10143;
  } else {
    delete env.DEPLOYER_PK; // dry runs never see a real key
    const index = Number(process.env.DRYRUN_ACCOUNT_INDEX ?? "7");
    env.DRYRUN_ACCOUNT_INDEX = String(index);
    deployer = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }).address;
    if (MODE === "solonet") {
      rpc = process.env.SOLONET_RPC ?? "http://localhost:8080";
      expected = 20143;
    } else {
      const port = process.env.FORK_PORT ?? "8548";
      anvil = spawn(path.join(FOUNDRY, "anvil"), ["--fork-url", TESTNET_RPC, "--port", port, "--silent"], {
        stdio: "ignore",
      });
      rpc = `http://127.0.0.1:${port}`;
      expected = 10143;
      for (let i = 0; ; i++) {
        try {
          await rpcCall(rpc, "eth_chainId");
          break;
        } catch {
          if (i > 60) throw new Error("anvil fork did not start");
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      // A fork of 10143 must still run the production delays; fund the public dev account inside the fork only.
      await rpcCall(rpc, "anvil_setBalance", [deployer, "0x3635C9ADC5DEA00000"]);
    }
  }

  try {
    const chainId = Number(await rpcCall<string>(rpc, "eth_chainId"));
    if (chainId === 143) throw new Error("refusing Monad mainnet (143)");
    if (chainId !== expected) throw new Error(`expected chain ${expected}, RPC is ${chainId}`);
    if (MODE === "fork") {
      // The forge script derives the dev key only on Solonet; on the fork pass the public dev key explicitly.
      const acct = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: Number(env.DRYRUN_ACCOUNT_INDEX) });
      const hd = acct.getHdKey().privateKey;
      if (!hd) throw new Error("could not derive the public dev account");
      env.DEPLOYER_PK = `0x${Buffer.from(hd).toString("hex")}`;
    }
    const block = await rpcCall<{ baseFeePerGas: string }>(rpc, "eth_getBlockByNumber", ["latest", false]);
    const baseFee = BigInt(block.baseFeePerGas);
    const gasPrice = BigInt(await rpcCall<string>(rpc, "eth_gasPrice"));
    const balance = BigInt(await rpcCall<string>(rpc, "eth_getBalance", [deployer, "latest"]));
    console.log(`mode ${MODE} · chain ${chainId} · deployer ${deployer} · balance ${Number(balance) / 1e18} MON`);

    const OUT = MODE === "broadcast" ? "deployments/monad-testnet.json" : `deployments/monad-testnet-dryrun-${MODE}.json`;
    const forgeArgs = ["script", "script/DeployTestnet.s.sol", "--rpc-url", rpc, "--broadcast", "--slow", "--gas-estimate-multiplier", MULT];
    const forge = path.join(FOUNDRY, "forge");

    if (MODE === "broadcast") {
      // Simulate first (no --broadcast), then refuse if the balance can't cover forge's estimate.
      const simOut = "deployments/monad-testnet-sim.json";
      const sim = spawnSync(forge, forgeArgs.filter((a) => a !== "--broadcast"), {
        cwd: C,
        env: { ...env, OUT: simOut },
        encoding: "utf8",
      });
      const m = /Estimated amount required:\s*([\d.]+) (?:ETH|MON)/.exec(sim.stdout ?? "");
      rmSync(path.join(C, simOut), { force: true });
      if (sim.status !== 0 || !m) {
        console.error((sim.stdout ?? "").slice(-2000), (sim.stderr ?? "").slice(-2000));
        throw new Error("simulation failed");
      }
      const need = BigInt(Math.ceil(Number(m[1]) * 1e18));
      console.log(`forge estimate: ${m[1]} MON required`);
      if (balance < need) {
        throw new Error(`deployer has ${Number(balance) / 1e18} MON, needs ≥ ${m[1]} MON; fund ${deployer} at https://faucet.monad.xyz`);
      }
    }

    // Never clobber a real testnet broadcast record with a dry run.
    const recDir = path.join(C, "broadcast/DeployTestnet.s.sol", String(chainId));
    const bak = `${recDir}.real-bak`;
    if (MODE !== "broadcast" && existsSync(recDir)) renameSync(recDir, bak);
    const restore = () => {
      if (existsSync(bak)) {
        rmSync(recDir, { recursive: true, force: true });
        renameSync(bak, recDir);
      }
    };
    const r = spawnSync(forge, forgeArgs, { cwd: C, env: { ...env, OUT }, encoding: "utf8" });
    if (r.status !== 0) {
      restore();
      console.error((r.stdout ?? "").slice(-3000), (r.stderr ?? "").slice(-3000));
      process.exit(r.status ?? 1);
    }

    const rec = JSON.parse(readFileSync(path.join(recDir, "run-latest.json"), "utf8")) as {
      transactions: { transaction: { gas: string } }[];
      receipts: { gasUsed: string; effectiveGasPrice?: string }[];
    };
    let used = BigInt(0);
    let limit = BigInt(0);
    for (const t of rec.transactions) limit += BigInt(t.transaction.gas);
    for (const x of rec.receipts) used += BigInt(x.gasUsed);
    console.log(`txs ${rec.transactions.length} · gas used ${used} · gas limit (what Monad charges) ${limit} at ×${Number(MULT) / 100}`);
    console.log(`base fee ${Number(baseFee) / 1e9} gwei · gasPrice ${Number(gasPrice) / 1e9} gwei`);
    console.log(`cost ≈ ${mon(limit, baseFee)} MON at base fee · ${mon(limit, gasPrice)} MON at gasPrice`);

    if (MODE !== "broadcast") {
      const dry = path.join(C, "broadcast-dryrun", `DeployTestnet-${chainId}-dryrun-${MODE}`);
      mkdirSync(path.dirname(dry), { recursive: true });
      rmSync(dry, { recursive: true, force: true });
      renameSync(recDir, dry);
      restore();
      console.log(`dry run only; throwaway addresses in contracts/${OUT}`);
    } else {
      mkdirSync(path.join(ROOT, "deployments"), { recursive: true });
      copyFileSync(path.join(C, OUT), path.join(ROOT, "deployments/monad-testnet.json"));
      console.log("DEPLOYED. deployments/monad-testnet.json written; commit it so the app can point at 10143.");
    }
  } finally {
    anvil?.kill();
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
