/** 0x1234…abcd */
export function shortAddress(addr: string | null | undefined): string {
  if (!addr || addr.length < 12) return addr ?? "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}
