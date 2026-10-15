import "server-only";
import { prisma } from "../db";
import { handleFromName } from "../auth-core";
import type { AuthDeps, AuthUserRef } from "./flows";

const select = { id: true, handle: true, walletAddress: true } as const;

/** Prisma-backed AuthDeps for the route handlers. */
export const prismaAuthDeps: AuthDeps = {
  findByWallet: (wallet) => prisma.user.findUnique({ where: { walletAddress: wallet.toLowerCase() }, select }),

  async createWithWallet({ wallet, displayName, credentialId }): Promise<AuthUserRef> {
    const taken = new Set((await prisma.user.findMany({ select: { handle: true } })).map((u) => u.handle));
    const user = await prisma.user.create({
      data: {
        name: displayName,
        handle: handleFromName(displayName, taken),
        walletAddress: wallet.toLowerCase(),
        walletVerified: true,
        walletVerifiedAt: new Date(),
        passkeyCredentialId: credentialId,
        verificationMethod: "mera",
      },
      select,
    });
    await prisma.workspace.create({ data: { name: "My pipeline", ownerId: user.id } });
    return user;
  },

  linkWallet: ({ userId, wallet, credentialId }) =>
    prisma.user.update({
      where: { id: userId },
      data: {
        walletAddress: wallet.toLowerCase(),
        walletVerified: true,
        walletVerifiedAt: new Date(),
        ...(credentialId ? { passkeyCredentialId: credentialId } : {}),
        verificationMethod: "mera",
      },
      select,
    }),
};
