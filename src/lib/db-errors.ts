/** Prisma's unique-constraint violation (a concurrent write took the value first). */
export function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}
