import { describe, expect, it, vi } from "vitest";
import { getScoutProvider, type ScoutInput } from "@/lib/scout";
import { AnthropicScoutProvider, OpenAIScoutProvider, buildScoutPrompt, parseScoutJson } from "@/lib/scout/llm";
import { MockScoutProvider } from "@/lib/scout/mock";

const input = (over: Partial<ScoutInput> = {}): ScoutInput => ({
  locale: "en",
  org: { name: "Bitso", type: "exchange", country: "MX", region: "latam", website: "https://bitso.com", chainsInUse: [], chainsEvaluating: [], notes: "" },
  sender: { name: "Ana López", role: "BD Lead", orgName: "EmpowerTours", voice: "" },
  signals: [],
  ...over,
});

describe("MockScoutProvider", () => {
  const mock = new MockScoutProvider();

  it("is deterministic and flags missing facts instead of inventing them", async () => {
    const a = await mock.generate(input());
    const b = await mock.generate(input());
    expect(a).toEqual(b);
    expect(a.provider).toBe("mock");
    expect(a.fit).toContain("No verified facts on file");
    expect(a.draft).toContain("Hi Bitso team,");
    expect(a.draft).toContain("Ana López — BD Lead, EmpowerTours");
    expect(a.angles.length).toBeGreaterThan(0);
  });

  it("uses known facts, champion name and signals", async () => {
    const r = await mock.generate(
      input({
        org: { ...input().org, chainsInUse: ["Ethereum"], notes: "Issues MXNB." },
        deal: { stage: "evaluation", useCase: "MXNB settlement", competingChains: ["Solana"], contacts: [{ name: "Maria Perez", title: "Head", isChampion: true }] },
        signals: [{ title: "Bitso expands MXNB" }],
      }),
    );
    expect(r.fit).toContain("Publicly uses: Ethereum.");
    expect(r.fit).toContain("Also evaluating: Solana.");
    expect(r.fit).toContain("On file: Issues MXNB.");
    expect(r.draft).toContain("Hi Maria,");
    expect(r.draft).toContain('I saw "Bitso expands MXNB"');
  });

  it("respects voice (short/formal) and Spanish", async () => {
    const short = await mock.generate(input({ sender: { ...input().sender, voice: "Short and direct" } }));
    expect(short.draft).not.toContain("A few concrete ideas");
    const es = await mock.generate(input({ locale: "es", sender: { ...input().sender, voice: "formal" } }));
    expect(es.draft).toContain("Estimado/a equipo de Bitso:");
    expect(es.draft).toContain("Saludos cordiales,");
  });

  it("falls back to builder copy for unknown org types", async () => {
    const r = await mock.generate(input({ org: { ...input().org, type: "???" } }));
    expect(r.fit).toMatch(/Builders/);
  });
});

describe("getScoutProvider", () => {
  it("defaults to mock with no keys", () => {
    expect(getScoutProvider({}).name).toBe("mock");
  });
  it("picks providers from env", () => {
    expect(getScoutProvider({ OPENAI_API_KEY: "x" }).name).toBe("openai");
    expect(getScoutProvider({ ANTHROPIC_API_KEY: "x" }).name).toBe("anthropic");
    expect(getScoutProvider({ OPENAI_API_KEY: "x", ANTHROPIC_API_KEY: "y", SCOUT_PROVIDER: "anthropic" }).name).toBe("anthropic");
    expect(getScoutProvider({ OPENAI_API_KEY: "x", SCOUT_PROVIDER: "mock" }).name).toBe("mock");
    expect(getScoutProvider({ SCOUT_PROVIDER: "openai" }).name).toBe("mock");
  });
});

describe("LLM providers (no network)", () => {
  const payload = { fit: "f", angles: ["a"], subject: "s", draft: "d" };

  it("prompt forbids invention and includes input", () => {
    const p = buildScoutPrompt(input({ locale: "es" }));
    expect(p).toContain("Do not invent");
    expect(p).toContain("Spanish");
    expect(p).toContain('"name": "Bitso"');
  });

  it("parseScoutJson tolerates surrounding text and validates", () => {
    expect(parseScoutJson("```json\n" + JSON.stringify(payload) + "\n```", "x")).toEqual({ provider: "x", ...payload });
    expect(() => parseScoutJson("nope", "x")).toThrow();
    expect(() => parseScoutJson('{"fit":""}', "x")).toThrow();
  });

  it("OpenAI provider calls chat completions with bearer key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] })));
    const r = await new OpenAIScoutProvider("k", "m", fetchImpl as unknown as typeof fetch).generate(input());
    expect(r).toMatchObject({ provider: "openai:m", draft: "d" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("api.openai.com");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer k");
  });

  it("Anthropic provider parses text content and surfaces HTTP errors", async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(payload) }] })));
    expect((await new AnthropicScoutProvider("k", "m", ok as unknown as typeof fetch).generate(input())).provider).toBe("anthropic:m");
    const bad = vi.fn(async () => new Response("no", { status: 401 }));
    await expect(new AnthropicScoutProvider("k", "m", bad as unknown as typeof fetch).generate(input())).rejects.toThrow("401");
  });
});
