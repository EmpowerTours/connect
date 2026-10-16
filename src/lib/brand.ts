/**
 * The ONE place the product name lives. Rename the app by editing `name` and
 * `subdomain` (host: <subdomain>.empowertours.xyz); everything
 * user-facing — titles, the sign-in statement, the passkey prompt — derives
 * from here.
 *
 * Deliberately NOT derived from this: the passkey PRF salt label in
 * src/lib/mera/derive.ts. Changing that salt would give every existing user a
 * different wallet, so it is pinned independently of the brand.
 */
export const BRAND = {
  name: "Connect",
  /** Lowercase, url-safe. Used for the host and for cookie names. */
  subdomain: "connect",
  parentDomain: "empowertours.xyz",
  ecosystem: "EmpowerTours",
  poweredBy: "Monad",
} as const;

export const APP_NAME: string = BRAND.name;
export const APP_HOST = `${BRAND.subdomain}.${BRAND.parentDomain}`;
/** Canonical base URL (metadataBase, canonical links). */
export const APP_URL = `https://${APP_HOST}`;
/** e.g. "EmpowerTours Connect" — what the passkey prompt and signature show. */
export const APP_FULL_NAME = `${BRAND.ecosystem} ${BRAND.name}`;

/** Public source repository (AGPL; linked from the sign-in page). */
export const SOURCE_URL = "https://github.com/EmpowerTours/connect";
