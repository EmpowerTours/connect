import { z } from "zod";
import type { IntroDraftInput, IntroDraftResult, ScoutInput, ScoutProvider, ScoutResult } from "./types";

const resultSchema = z.object({
  fit: z.string().min(1),
  angles: z.array(z.string()).max(6),
  subject: z.string().min(1),
  draft: z.string().min(1),
});

export function buildScoutPrompt(input: ScoutInput): string {
  const lang = input.locale === "es" ? "Spanish (Mexico)" : "English";
  return [
    "You are a business-development research assistant for a blockchain ecosystem team.",
    `Write in ${lang}.`,
    "Use ONLY the facts in the JSON below. Do not invent partnerships, people, numbers, or chain usage. If facts are missing, say so in the fit summary.",
    "Write the outreach draft in the sender's voice as described in sender.voice. Keep it under 150 words.",
    'Respond with JSON only: {"fit": string, "angles": string[], "subject": string, "draft": string}.',
    "",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

export function buildIntroPrompt(input: IntroDraftInput): string {
  const lang = input.locale === "es" ? "Spanish (Mexico)" : "English";
  return [
    "Draft a short, warm message asking a mutual connection for an introduction.",
    `Write in ${lang}, in the requester's voice (requester.voice). Under 120 words. Make it easy to say no.`,
    "Use ONLY the facts below. Do not invent shared history, numbers or companies.",
    "Respond with the message text only.",
    "",
    JSON.stringify(input, null, 2),
  ].join("\n");
}

export function parseScoutJson(text: string, provider: string): ScoutResult {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error("Scout provider returned no JSON");
  const parsed = resultSchema.parse(JSON.parse(text.slice(start, end + 1)));
  return { provider, ...parsed };
}

export class OpenAIScoutProvider implements ScoutProvider {
  readonly name = "openai";
  constructor(private apiKey: string, private model = "gpt-4o-mini", private fetchImpl: typeof fetch = fetch) {}

  async generate(input: ScoutInput): Promise<ScoutResult> {
    const res = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        response_format: { type: "json_object" },
        messages: [{ role: "user", content: buildScoutPrompt(input) }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return parseScoutJson(data.choices?.[0]?.message?.content ?? "", `${this.name}:${this.model}`);
  }

  async draftIntro(input: IntroDraftInput): Promise<IntroDraftResult> {
    const res = await this.fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages: [{ role: "user", content: buildIntroPrompt(input) }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const message = data.choices?.[0]?.message?.content?.trim();
    if (!message) throw new Error("Empty intro draft");
    return { provider: `${this.name}:${this.model}`, message };
  }
}

export class AnthropicScoutProvider implements ScoutProvider {
  readonly name = "anthropic";
  constructor(private apiKey: string, private model = "claude-3-5-haiku-latest", private fetchImpl: typeof fetch = fetch) {}

  async generate(input: ScoutInput): Promise<ScoutResult> {
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [{ role: "user", content: buildScoutPrompt(input) }],
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Anthropic error ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = data.content?.find((c) => c.type === "text")?.text ?? "";
    return parseScoutJson(text, `${this.name}:${this.model}`);
  }

  async draftIntro(input: IntroDraftInput): Promise<IntroDraftResult> {
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: this.model, max_tokens: 512, messages: [{ role: "user", content: buildIntroPrompt(input) }] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`Anthropic error ${res.status}`);
    const data = (await res.json()) as { content?: { type: string; text?: string }[] };
    const message = data.content?.find((c) => c.type === "text")?.text?.trim();
    if (!message) throw new Error("Empty intro draft");
    return { provider: `${this.name}:${this.model}`, message };
  }
}
