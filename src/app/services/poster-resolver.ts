/**
 * Resolve movie posters + metadata from TMDB by filename.
 *
 * Pipeline:
 *   1. Check local cache first (30-day TTL for hits, 7-day for misses).
 *   2. Normalize the filename → clean title + year + quality.
 *   3. Query TMDB search/movie with the key the user provided.
 *   4. On hit → store poster, backdrop, overview, year.
 *   5. On miss → store a miss sentinel so we don't re-query for 7 days.
 *   6. No TMDB key → return a no-key stub (UI falls back to Drive thumbnail).
 *
 * Throttle: max 4 concurrent TMDB fetches.
 */

import type { DriveFile } from "@shared/types";
import type { MovieMetadata } from "@shared/types";
import { normalizeMovieTitle } from "./title-normalizer";
import { getCached, setCached } from "./metadata-cache";
import { getTmdbKey } from "./tmdb-key";

const TMDB_API = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";

let activeFetches = 0;
const queue: (() => void)[] = [];

async function withThrottle<T>(fn: () => Promise<T>): Promise<T> {
  if (activeFetches >= 4) {
    await new Promise<void>((resolve) => queue.push(resolve));
  }
  activeFetches++;
  try {
    return await fn();
  } finally {
    activeFetches--;
    const next = queue.shift();
    if (next) next();
  }
}

export async function resolvePoster(file: DriveFile): Promise<MovieMetadata> {
  // 1. Cache
  const cached = await getCached(file.id);
  if (cached) return cached;

  // 2. No key → stub (UI falls back to Drive thumbnail)
  const key = await getTmdbKey();
  if (!key) {
    const stub: MovieMetadata = {
      fileId: file.id,
      title: normalizeMovieTitle(file.name).title,
      quality: undefined,
      status: "miss",
      fetchedAt: Date.now(),
    };
    return stub;
  }

  // 3. Normalize
  const normalized = normalizeMovieTitle(file.name);

  // 4. Fetch with throttle
  const meta = await withThrottle(() =>
    fetchTmdb(
      normalized.title,
      normalized.year,
      normalized.quality ?? undefined,
      file,
      key,
    ),
  );
  await setCached(meta);
  return meta;
}

async function fetchTmdb(
  title: string,
  year: number | null,
  quality: string | undefined,
  file: DriveFile,
  key: string,
): Promise<MovieMetadata> {
  const query = encodeURIComponent(title);
  const yearParam = year ? `&primary_release_year=${year}` : "";
  const url = `${TMDB_API}/search/movie?query=${query}${yearParam}&api_key=${key}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return miss(file, title, quality);
    }
    const data = (await res.json()) as {
      results?: Array<{
        id: number;
        title: string;
        release_date?: string;
        poster_path?: string | null;
        backdrop_path?: string | null;
        overview?: string;
      }>;
    };
    let results = data.results ?? [];

    // If zero results and we had a year, retry without year
    if (results.length === 0 && year) {
      const retryUrl = `${TMDB_API}/search/movie?query=${query}&api_key=${key}`;
      const retryRes = await fetch(retryUrl);
      if (retryRes.ok) {
        const retryData = (await retryRes.json()) as typeof data;
        results = retryData.results ?? [];
      }
    }

    const hit = results[0];
    if (!hit) return miss(file, title, quality);

    return {
      fileId: file.id,
      title: hit.title,
      year: hit.release_date
        ? Number(hit.release_date.slice(0, 4)) || undefined
        : undefined,
      overview: hit.overview || undefined,
      posterUrl: hit.poster_path
        ? `${POSTER_BASE}${hit.poster_path}`
        : undefined,
      backdropUrl: hit.backdrop_path
        ? `${BACKDROP_BASE}${hit.backdrop_path}`
        : undefined,
      quality: quality ?? undefined,
      tmdbId: hit.id,
      status: "ok",
      fetchedAt: Date.now(),
    };
  } catch {
    return miss(file, title, quality);
  }
}

function miss(
  file: DriveFile,
  title: string,
  quality: string | undefined,
): MovieMetadata {
  return {
    fileId: file.id,
    title,
    quality: quality ?? undefined,
    status: "miss",
    fetchedAt: Date.now(),
  };
}
