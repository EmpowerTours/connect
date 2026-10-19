/**
 * Self-submit: when the relayer declines, the member's signed request can be sent to the gateway
 * by ANY wallet (the gateway never looks at msg.sender; every call carries the member's own
 * signatures). The app shows the exact calldata to send from a wallet of their choice. Connect
 * never asks the shared Mera key to sign a transaction (tests/ecosystem-wallet.test.ts).
 */
import { encodeFunctionData, type Address, type Hex } from "viem";
import { gatewayAbi } from "./abi";
import { actionCall, registerArgs, type ActionPayload, type RegisterPayload } from "./payloads";

export type SignedCall = { kind: "register"; payload: RegisterPayload } | { kind: "action"; payload: ActionPayload };

export function signedCall(c: SignedCall): { functionName: string; args: readonly unknown[] } {
  return c.kind === "register" ? { functionName: "register", args: registerArgs(c.payload) } : actionCall(c.payload);
}

/** Calldata for the gateway call carrying the member's signatures. */
export function signedCallData(c: SignedCall): Hex {
  const { functionName, args } = signedCall(c);
  return encodeFunctionData({ abi: gatewayAbi, functionName, args } as Parameters<typeof encodeFunctionData>[0]);
}

export interface SelfSubmit {
  chainId: number;
  to: Address;
  data: Hex;
  value: "0";
}

export function selfSubmit(chainId: number, gateway: Address, c: SignedCall): SelfSubmit {
  return { chainId, to: gateway, data: signedCallData(c), value: "0" };
}
