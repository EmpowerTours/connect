/** Request body schemas for the auth routes (Hunt's LoginInput, adapted). */
import { z } from "zod";
import { isUsableCredentialId } from "./derive";

const wallet = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const clientTs = z.union([z.number().int(), z.string().regex(/^\d{1,12}$/)]).transform((v) => BigInt(v));
const nonce = z.string().min(16).max(128);
const signature = z.string().regex(/^0x[0-9a-fA-F]{130,}$/).transform((s) => s as `0x${string}`);
const credentialId = z.string().max(256).refine(isUsableCredentialId, "invalid credential id");

export const LoginInput = z.object({
  wallet,
  statement: z.string().max(300),
  clientTs,
  nonce,
  signature,
  passkeyCredentialId: credentialId.optional(),
});

export const RegisterInput = z.object({
  wallet,
  displayName: z.string().trim().min(1).max(60),
  passkeyCredentialId: credentialId,
  clientTs,
  nonce,
  signature,
});

export type LoginInputT = z.infer<typeof LoginInput>;
export type RegisterInputT = z.infer<typeof RegisterInput>;
