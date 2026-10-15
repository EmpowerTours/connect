/**
 * Admins are a wallet allowlist: ADMIN_WALLETS = comma-separated EVM addresses.
 * Admin rights need a Mera (passkey-verified) session for an allowlisted
 * wallet. The local demo login is never an admin.
 */
const ADDRESS = /^0x[0-9a-f]{40}$/;

export function adminWallets(env: Record<string, string | undefined> = process.env): Set<string> {
  return new Set(
    (env.ADMIN_WALLETS ?? "")
      .split(/[\s,]+/)
      .map((a) => a.trim().toLowerCase())
      .filter((a) => ADDRESS.test(a)),
  );
}

export function isAdmin(
  user: { walletVerified: boolean; walletAddress: string | null } | null | undefined,
  method: "mera" | "demo" | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (!user || method !== "mera" || !user.walletVerified || !user.walletAddress) return false;
  return adminWallets(env).has(user.walletAddress.toLowerCase());
}
