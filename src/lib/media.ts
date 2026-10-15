/** Public URL for a stored media key (served by src/app/media/[...key]/route.ts). */
export function avatarUrl(key: string | null | undefined): string | null {
  return key ? `/media/${key}` : null;
}
