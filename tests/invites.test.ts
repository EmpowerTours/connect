import { describe, expect, it } from "vitest";
import { INVITE_ALPHABET, INVITE_CODE_LENGTH, INVITE_COOKIE_MAX_AGE, inviteUrl, newInviteCode, parseInviteCode } from "@/lib/invites";

describe("invite codes", () => {
  it("are 8 characters from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = newInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      for (const ch of code) expect(INVITE_ALPHABET).toContain(ch);
      expect(parseInviteCode(code)).toBe(code);
    }
    expect(INVITE_ALPHABET).not.toMatch(/[01ilo]/);
  });

  it("skip bytes that would bias the alphabet", () => {
    // 248..255 are rejected (256 % 31 = 8); 0 and 30 map to the first and last letter.
    let calls = 0;
    const random = (n: number) => {
      calls++;
      return calls === 1 ? new Uint8Array(n).fill(250) : Uint8Array.from({ length: n }, (_, i) => (i % 2 ? 30 : 0));
    };
    expect(newInviteCode(random)).toBe("2z2z2z2z");
    expect(calls).toBe(2);
  });

  it("parse only well-formed codes, case-insensitively", () => {
    expect(parseInviteCode(" ABCD2345 ")).toBe("abcd2345");
    for (const bad of [null, undefined, "", "abcd234", "abcd23456", "abcd234o", "abcd-345", "../admin"]) expect(parseInviteCode(bad), String(bad)).toBeNull();
  });

  it("build the link on the given origin and keep the cookie for 30 days", () => {
    expect(inviteUrl("https://connect.empowertours.xyz/", "abcd2345")).toBe("https://connect.empowertours.xyz/i/abcd2345");
    expect(INVITE_COOKIE_MAX_AGE).toBe(30 * 86_400);
  });
});
