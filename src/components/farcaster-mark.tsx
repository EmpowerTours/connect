/** The Farcaster arch, drawn inline (no remote asset). */
export function FarcasterMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="currentColor">
      <path d="M5 3h14v18h-2.6v-7.6a4.4 4.4 0 0 0-8.8 0V21H5z" />
    </svg>
  );
}
