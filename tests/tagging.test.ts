import { describe, expect, it } from "vitest";
import { extractCashtags, matchOrgs } from "@/lib/tagging";

const org = (id: string, name: string, aliases: string[] = []) => ({ id, name, aliases: JSON.stringify(aliases) });
const orgs = [
  org("ice", "Intercontinental Exchange", ["ICE", "NYSE"]),
  org("circle", "Circle", ["USDC"]),
  org("ey", "EY", ["Ernst & Young"]),
  org("bitso", "Bitso", ["Juno", "MXNB"]),
  org("jpm", "JPMorgan Chase", ["JPMorgan", "J.P. Morgan"]),
  org("mp", "Mercado Pago", ["Meli Dólar"]),
  org("citi", "Citi", ["Citigroup"]),
];
const ids = (text: string) => matchOrgs(text, orgs).map((o) => o.id);

describe("matchOrgs", () => {
  it("matches names and aliases on word boundaries", () => {
    expect(ids("Bitso launches MXNB on a new chain")).toEqual(["bitso"]);
    expect(ids("J.P. Morgan and NYSE parent ICE announce pilot")).toEqual(["ice", "jpm"]);
    expect(ids("Mercado Pago expands Meli Dólar")).toEqual(["mp"]);
  });
  it("avoids common-word and substring false positives", () => {
    expect(ids("Let's circle back on the ice cream they want")).toEqual([]);
    expect(ids("Bitsoft is not Bitso-related? Actually Bitso-related is.")).toEqual(["bitso"]);
    expect(ids("Citizens bank and the city")).toEqual([]);
    expect(ids("Juniper networks")).toEqual([]);
  });
  it("matches multi-word and acronym orgs", () => {
    expect(ids("Report by EY on stablecoins")).toEqual(["ey"]);
    expect(ids("Ernst & Young report")).toEqual(["ey"]);
    expect(ids("Circle's USDC")).toEqual(["circle"]);
  });
  it("handles empty text", () => {
    expect(ids("   ")).toEqual([]);
  });
});

describe("extractCashtags", () => {
  it("extracts $slug tags, lower-cased and unique", () => {
    expect(extractCashtags("Talking to $Bitso and $mercado-pago, also $bitso again. Price is $5")).toEqual(["bitso", "mercado-pago"]);
  });
  it("ignores mid-word dollars", () => {
    expect(extractCashtags("US$bitso")).toEqual([]);
  });
});
