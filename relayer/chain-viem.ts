/** viem implementation of RelayChain against the configured gateway. */
import { createWalletClient, http, parseEventLogs, type Account, type Address, type Chain, type Hex, type PublicClient } from "viem";
import { gatewayAbi, idRegistryAbi } from "../src/lib/protocol/abi";
import type { ProtocolDeployment } from "../src/lib/protocol/deployments";
import type { RelayChain, RelayFees, RelayReceipt } from "../src/lib/protocol/relayer/service";

export function viemRelayChain(client: PublicClient, chain: Chain, rpcUrl: string, account: Account, d: ProtocolDeployment): RelayChain {
  const wallet = createWalletClient({ account, chain, transport: http(rpcUrl, { timeout: 15_000 }) });
  const call = (functionName: string, args: readonly unknown[]) =>
    ({ address: d.gateway, abi: gatewayAbi, functionName, args, account }) as unknown as Parameters<PublicClient["simulateContract"]>[0];
  return {
    chainId: d.chainId,
    relayer: account.address,
    async simulate(functionName, args) {
      await client.simulateContract(call(functionName, args));
    },
    estimateGas(functionName, args) {
      return client.estimateContractGas(call(functionName, args) as Parameters<PublicClient["estimateContractGas"]>[0]);
    },
    async fees(): Promise<RelayFees> {
      const f = await client.estimateFeesPerGas();
      const maxFeePerGas = f.maxFeePerGas ?? (await client.getGasPrice());
      return { maxFeePerGas, maxPriorityFeePerGas: f.maxPriorityFeePerGas ?? BigInt(0) };
    },
    balance() {
      return client.getBalance({ address: account.address });
    },
    async send(functionName, args, gas, fees) {
      const req = { ...call(functionName, args), chain, gas, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas };
      return wallet.writeContract(req as Parameters<typeof wallet.writeContract>[0]);
    },
    async receipt(hash: Hex, timeoutMs: number): Promise<RelayReceipt | null> {
      try {
        const rc = await client.waitForTransactionReceipt({ hash, timeout: timeoutMs, pollingInterval: 500 });
        const reg = parseEventLogs({ abi: idRegistryAbi, logs: rc.logs, eventName: "Registered" }).find((l) => l.address.toLowerCase() === d.idRegistry.toLowerCase());
        return {
          status: rc.status,
          gasUsed: rc.gasUsed,
          effectiveGasPrice: rc.effectiveGasPrice,
          registeredId: reg ? BigInt(reg.args.id) : null,
        };
      } catch (e) {
        if ((e as { name?: string }).name === "WaitForTransactionReceiptTimeoutError") return null;
        throw e;
      }
    },
    idOf(owner: Address) {
      return client.readContract({ address: d.idRegistry, abi: idRegistryAbi, functionName: "idOf", args: [owner] });
    },
  };
}
