/**
 * The profile fields a signed-out visitor may see on public pages (src/lib/public-pages.ts).
 * Never add email, wallet address, passkey, writing voice or linked-account ids here
 * (tests/seo.test.ts checks this).
 */
export const publicUserSelect = {
  id: true,
  name: true,
  handle: true,
  headline: true,
  role: true,
  orgName: true,
  bio: true,
  location: true,
  region: true,
  focusTags: true,
  avatarKey: true,
  isDemo: true,
  onboardedAt: true,
  createdAt: true,
  linkX: true,
  linkLinkedin: true,
  linkWebsite: true,
  workEmailVerified: true,
  linkedinVerified: true,
  walletVerified: true,
  org: { select: { slug: true, name: true } },
  _count: { select: { followers: true, following: true, posts: true } },
} as const;
