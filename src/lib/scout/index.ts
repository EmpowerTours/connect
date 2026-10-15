import { AnthropicScoutProvider, OpenAIScoutProvider } from "./llm";
import { MockScoutProvider } from "./mock";
import type { ScoutProvider } from "./types";

export type { ScoutInput, ScoutProvider, ScoutResult } from "./types";

type Env = Record<string, string | undefined>;

/**
 * Picks the scout provider from env. SCOUT_PROVIDER forces one; otherwise the
 * first configured key wins; with no keys the offline mock is used.
 */
export function getScoutProvider(env: Env = process.env): ScoutProvider {
  const forced = env.SCOUT_PROVIDER?.toLowerCase();
  if (forced === "mock") return new MockScoutProvider();
  if ((forced === "openai" || !forced) && env.OPENAI_API_KEY) return new OpenAIScoutProvider(env.OPENAI_API_KEY, env.OPENAI_MODEL || undefined);
  if ((forced === "anthropic" || !forced) && env.ANTHROPIC_API_KEY)
    return new AnthropicScoutProvider(env.ANTHROPIC_API_KEY, env.ANTHROPIC_MODEL || undefined);
  return new MockScoutProvider();
}
