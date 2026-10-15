export { APP_NAME } from "./brand";

export const ORG_TYPES = [
  "foundation",
  "bank",
  "exchange",
  "custodian",
  "asset_manager",
  "market_infra",
  "fintech",
  "advisor",
  "builder",
] as const;
export type OrgType = (typeof ORG_TYPES)[number];

export const REGIONS = ["north_america", "latam", "europe", "apac", "mea"] as const;
export type Region = (typeof REGIONS)[number];

/** ISO-3166 alpha-2 → region. Unknown countries map to "" (left empty). */
const COUNTRY_REGION: Record<string, Region> = {
  US: "north_america", CA: "north_america",
  MX: "latam", BR: "latam", AR: "latam", CO: "latam", CL: "latam", PE: "latam", UY: "latam",
  GB: "europe", ES: "europe", CH: "europe", BE: "europe", IE: "europe", DE: "europe", FR: "europe", NL: "europe",
  SG: "apac", JP: "apac", KR: "apac", HK: "apac", CN: "apac", AU: "apac",
  AE: "mea", ZA: "mea", NG: "mea",
};

export function regionForCountry(country: string): Region | "" {
  return COUNTRY_REGION[country.trim().toUpperCase()] ?? "";
}

export const ADVISOR_INFLUENCE = ["low", "medium", "high"] as const;
export const ACTIVITY_KINDS = ["note", "call", "meeting", "email", "stage_change", "scout"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export const POST_MAX_LENGTH = 320;
