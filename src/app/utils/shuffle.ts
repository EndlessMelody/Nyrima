/** Fisher–Yates shuffle, non-destructive. */
export function shuffle<T>(arr: readonly T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Deterministic top-N pick. Same `seed` + same input ids always returns the
 * same items in the same order — useful for "random" surfaces (suggestion
 * rows, featured picks) that should stay stable across React re-renders so
 * the lobby doesn't reshuffle every time a background fetch resolves.
 */
export function pickSeeded<T>(
  arr: readonly T[],
  n: number,
  seed: string,
  keyOf: (item: T) => string,
): T[] {
  if (arr.length === 0 || n <= 0) return [];
  return arr
    .map((item) => ({ item, score: hashString(`${seed}:${keyOf(item)}`) }))
    .sort((a, b) => a.score - b.score)
    .slice(0, n)
    .map(({ item }) => item);
}

/** FNV-1a 32-bit. Stable across runs; fine for non-cryptographic seeding. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
