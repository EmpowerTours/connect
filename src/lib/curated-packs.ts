/**
 * Starter packs for onboarding: curated follow sets built from the seeded organizations
 * (prisma/seed-data.ts) and topic channels (prisma/seed-base.ts), so a new member lands in a
 * feed that already has something in it. Picking a pack follows its organizations, joins its
 * channels and follows the people verified at those organizations or most active in those
 * channels (src/lib/curated-packs-db.ts). Pure data and rules; tests/curated-packs.test.ts
 * checks every slug against the seed.
 *
 * Not to be confused with the wallet starter packs in src/lib/importers/wallet.ts, which
 * suggest people who hold the same onchain token.
 */
import type { FocusTag } from "./onboarding";

export interface CuratedPack {
  id: string;
  label: { en: string; es: string };
  blurb: { en: string; es: string };
  /** Focus areas this pack fits; used to recommend it. */
  focus: readonly FocusTag[];
  /** Channel slugs to join. */
  channels: readonly string[];
  /** Organization slugs to follow. */
  orgs: readonly string[];
}

export const CURATED_PACKS: readonly CuratedPack[] = [
  {
    id: "stablecoin_rails",
    label: { en: "Stablecoin rails", es: "Rieles de stablecoins" },
    blurb: { en: "Issuers, payment networks and the people building on them.", es: "Emisores, redes de pago y quienes construyen sobre ellas." },
    focus: ["stablecoins", "payments", "treasury"],
    channels: ["stablecoins"],
    orgs: ["circle", "ripple", "stripe", "stellar-development-foundation", "coinbase"],
  },
  {
    id: "latam_payments",
    label: { en: "LatAm payments", es: "Pagos en LatAm" },
    blurb: { en: "SPEI, PIX, remittance corridors and the fintechs moving money.", es: "SPEI, PIX, corredores de remesas y las fintechs que mueven dinero." },
    focus: ["payments", "remittances", "wallets"],
    channels: ["latam-payments"],
    orgs: ["bitso", "mercado-pago", "nubank", "uala", "ripio", "mercado-bitcoin", "banorte", "fintech-mexico"],
  },
  {
    id: "tokenization",
    label: { en: "Tokenization and RWA", es: "Tokenización y RWA" },
    blurb: { en: "Tokenized funds, deposits and securities, from issuers to transfer agents.", es: "Fondos, depósitos y valores tokenizados, de emisores a agentes de transferencia." },
    focus: ["tokenization", "rwa", "treasury"],
    channels: ["tokenization", "rwa"],
    orgs: ["blackrock", "franklin-templeton", "securitize", "wisdomtree", "jpmorgan-chase", "fidelity-investments"],
  },
  {
    id: "custody_market_infra",
    label: { en: "Custody and market infrastructure", es: "Custodia e infraestructura de mercado" },
    blurb: { en: "Custodians, exchanges, clearing and settlement.", es: "Custodios, exchanges, compensación y liquidación." },
    focus: ["custody", "market_infra", "compliance"],
    channels: ["custody", "market-structure"],
    orgs: ["anchorage-digital", "bny", "state-street", "fireblocks", "dtcc", "euroclear", "cme-group"],
  },
  {
    id: "monad_builders",
    label: { en: "Monad builders", es: "Builders de Monad" },
    blurb: { en: "The Monad ecosystem and the infrastructure teams around it.", es: "El ecosistema Monad y los equipos de infraestructura a su alrededor." },
    focus: ["infrastructure", "defi", "wallets"],
    channels: ["monad"],
    orgs: ["monad-foundation", "chainlink-labs", "alchemy"],
  },
  {
    id: "bd_craft",
    label: { en: "BD craft", es: "Oficio de BD" },
    blurb: { en: "Playbooks and people who close institutional deals.", es: "Playbooks y personas que cierran acuerdos institucionales." },
    focus: ["compliance", "market_infra", "infrastructure"],
    channels: ["bd-craft"],
    orgs: ["deloitte", "pwc", "ey", "accenture"],
  },
];

/** At most this many people are followed per pack. */
export const PACK_PEOPLE_MAX = 12;
/** Packs preselected in onboarding. */
export const PACKS_PRESELECTED = 2;

export function getCuratedPack(id: string): CuratedPack | undefined {
  return CURATED_PACKS.find((p) => p.id === id);
}

/** Known pack ids from a form, deduped, in pack order. */
export function pickPackIds(raw: string[]): string[] {
  const want = new Set(raw.map((r) => r.trim()));
  return CURATED_PACKS.filter((p) => want.has(p.id)).map((p) => p.id);
}

/**
 * Packs ordered by how many of the member's focus areas they cover (ties keep the list order),
 * with the best `PACKS_PRESELECTED` matches marked. With no overlap nothing is preselected.
 */
export function rankPacks(focus: readonly string[]): { pack: CuratedPack; score: number; preselected: boolean }[] {
  const mine = new Set(focus);
  const scored = CURATED_PACKS.map((pack, i) => ({ pack, i, score: pack.focus.filter((f) => mine.has(f)).length }));
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.map(({ pack, score }, rank) => ({ pack, score, preselected: score > 0 && rank < PACKS_PRESELECTED }));
}
