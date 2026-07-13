/**
 * Tiny pub-sub so low-level storage writes (playback positions, recent
 * folders) can nudge the profile-stats sync without creating an import
 * cycle back into the Zustand store that owns that sync. Zero dependencies
 * by design — anything can import this.
 */

type Listener = () => void;

const listeners = new Set<Listener>();

export function markProfileStatsDirty(): void {
  for (const listener of listeners) listener();
}

export function onProfileStatsDirty(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
