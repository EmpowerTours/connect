export type ScoutLocale = "en" | "es";

export interface ScoutInput {
  locale: ScoutLocale;
  org: {
    name: string;
    type: string;
    country: string;
    region: string;
    website: string;
    chainsInUse: string[];
    chainsEvaluating: string[];
    notes: string;
  };
  deal?: {
    stage: string;
    useCase: string;
    competingChains: string[];
    contacts: { name: string; title: string; isChampion: boolean }[];
  };
  sender: {
    name: string;
    role: string;
    orgName: string;
    /** How the user writes — e.g. "short, direct, no buzzwords". */
    voice: string;
  };
  /** Recent tagged news/posts about the org (titles only). */
  signals: { title: string; url?: string | null }[];
}

export interface ScoutResult {
  provider: string;
  fit: string;
  angles: string[];
  subject: string;
  draft: string;
}

/** Pluggable AI scout. Implementations must only use facts present in the input. */
export interface ScoutProvider {
  readonly name: string;
  generate(input: ScoutInput): Promise<ScoutResult>;
}
