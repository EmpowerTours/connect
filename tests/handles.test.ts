import { describe, expect, it } from "vitest";
import { handleFromName } from "@/lib/auth-core";
import { PLACEHOLDER_NAME, isGeneratedPlaceholder, isPlaceholderHandle, isPlaceholderName, normalizeHandle, suggestHandle, validateHandle } from "@/lib/handles";

describe("handles", () => {
  it("a sign-up without a name gets a placeholder handle, which is detected", () => {
    // What a passkey sign-in for a wallet with no profile produced in production.
    expect(handleFromName(PLACEHOLDER_NAME, new Set())).toBe("new_member");
    expect(handleFromName(PLACEHOLDER_NAME, new Set(["new_member"]))).toBe("new_member2");
    for (const h of ["new_member", "new_member2", "member", "member12", "user", "user3"]) expect(isPlaceholderHandle(h), h).toBe(true);
    for (const h of ["earvin", "new_members", "ana_member", "username", "membership"]) expect(isPlaceholderHandle(h), h).toBe(false);
    expect(isPlaceholderName(" new MEMBER ")).toBe(true);
    expect(isPlaceholderName("Earvin")).toBe(false);
  });

  it("normalizes @, case and spaces at the ends", () => {
    expect(normalizeHandle("  @Earvin_G ")).toBe("earvin_g");
    expect(normalizeHandle("@@ana")).toBe("ana");
  });

  it("accepts 2-24 of a-z 0-9 _, refuses reserved words and placeholders", () => {
    expect(validateHandle("@Earvin")).toEqual({ ok: true, value: "earvin" });
    expect(validateHandle("a".repeat(24))).toEqual({ ok: true, value: "a".repeat(24) });
    expect(validateHandle("a")).toEqual({ ok: false, error: "handle_format" });
    expect(validateHandle("a".repeat(25))).toEqual({ ok: false, error: "handle_format" });
    expect(validateHandle("ana ruiz")).toEqual({ ok: false, error: "handle_format" });
    expect(validateHandle("ana-ruiz")).toEqual({ ok: false, error: "handle_format" });
    expect(validateHandle("añá")).toEqual({ ok: false, error: "handle_format" });
    expect(validateHandle("")).toEqual({ ok: false, error: "handle_format" });
    expect(validateHandle("Admin")).toEqual({ ok: false, error: "handle_reserved" });
    expect(validateHandle("empowertours")).toEqual({ ok: false, error: "handle_reserved" });
    expect(validateHandle("new_member")).toEqual({ ok: false, error: "handle_reserved" });
    expect(validateHandle("new_member7")).toEqual({ ok: false, error: "handle_reserved" });
  });

  it("suggests a free handle from the real name, never from the placeholder", () => {
    expect(suggestHandle("Earvin Gallardo", new Set())).toBe("earvin_gallardo");
    expect(suggestHandle("Earvin Gallardo", new Set(["earvin_gallardo"]))).toBe("earvin_gallardo2");
    expect(suggestHandle("José Núñez", new Set())).toBe("jose_nunez");
    expect(suggestHandle("Admin", new Set())).toBe("admin2");
    expect(suggestHandle(PLACEHOLDER_NAME, new Set())).toBeNull();
    expect(suggestHandle("   ", new Set())).toBeNull();
    expect(suggestHandle("Member", new Set())).toBeNull();
    const s = suggestHandle("李小龙", new Set());
    expect(s === null || validateHandle(s).ok).toBe(true);
  });

  it("treats only untouched nameless sign-ups as generated placeholders", () => {
    expect(isGeneratedPlaceholder({ handle: "new_member", name: "New member" })).toBe(true);
    expect(isGeneratedPlaceholder({ handle: "new_member3", name: "New member" })).toBe(true);
    // A handle the member chose, or an account that already has a real name, is left alone.
    expect(isGeneratedPlaceholder({ handle: "user3", name: "Alice" })).toBe(false);
    expect(isGeneratedPlaceholder({ handle: "new_member", name: "Earvin" })).toBe(false);
    expect(isGeneratedPlaceholder({ handle: "earvin", name: "New member" })).toBe(false);
  });
});
