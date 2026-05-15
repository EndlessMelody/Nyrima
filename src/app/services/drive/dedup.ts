/**
 * In-flight request dedup.
 *
 * If two components both ask for the same folder listing at the same time,
 * we want a SINGLE underlying Drive call. `inflight(key, factory)` returns
 * the existing promise when one is already running for that key, otherwise
 * registers and returns the new one.
 *
 * Note: dedup is keyed by the *operation*, not by URL. Two callers reading
 * the same fileId with different `fields=` should not share a result, so
 * pass field signatures into the key.
 *
 * Aborts: per-call AbortSignals do NOT cancel the shared underlying call
 * (a single subscriber aborting shouldn't starve others). Callers see the
 * underlying error/result; if every subscriber aborts, the upstream task
 * runs to completion but its result is simply discarded.
 */

interface Pending<T> {
  promise: Promise<T>;
  subscribers: number;
}

const inflightMap = new Map<string, Pending<unknown>>();

let hits = 0;
let misses = 0;

export function inflight<T>(
  key: string,
  factory: () => Promise<T>,
): Promise<T> {
  const existing = inflightMap.get(key);
  if (existing) {
    hits += 1;
    existing.subscribers += 1;
    return existing.promise as Promise<T>;
  }
  misses += 1;
  const promise = factory().finally(() => {
    inflightMap.delete(key);
  });
  inflightMap.set(key, { promise, subscribers: 1 });
  return promise;
}

export function getDedupStats(): {
  hits: number;
  misses: number;
  inflight: number;
} {
  return { hits, misses, inflight: inflightMap.size };
}

export function clearDedup(): void {
  inflightMap.clear();
}
