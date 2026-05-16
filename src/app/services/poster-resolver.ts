/**
 * Resolve anime posters + metadata from MyAnimeList via the Jikan v4 API.
 *
 * Why Jikan instead of TMDB:
 *   - Nyrima is an anime-focused personal cinema; MAL's catalog is the
 *     definitive source for series, OVAs, and films.
 *   - Jikan exposes MAL data without an API key — fits the "no backend,
 *     no secrets" project posture.
 *
 * Pipeline:
 *   1. Check local cache first (30-day TTL for hits, 7-day for misses).
 *   2. Normalize the filename → clean title + year + quality.
 *   3. Query `GET /v4/anime?q=<title>` and pick the best match.
 *   4. On hit → store poster, overview, score, episodes, type, genres.
 *   5. On miss → store a miss sentinel so we don't re-query for 7 days.
 *
 * Rate limits:
 *   Jikan's public endpoint is throttled at ~3 req/sec, 60/min. We cap
 *   concurrency to 2 and stagger requests with a small jitter so a freshly
 *   opened large library doesn't burst past the per-second budget and earn
 *   a temporary IP ban.
 */

import type { DriveFile, MovieMetadata } from "@shared/types";
import { isEpisodicFilename, normalizeMovieTitle } from "@shared/title-parser";
import { getCached, setCached } from "./metadata-cache";

const JIKAN_API = "https://api.jikan.moe/v4";

/** Conservative concurrency cap. Jikan's public API also has a per-minute
 *  bucket, so a large library must trickle requests rather than burst. */
const MAX_CONCURRENT = 1;
/** Minimum gap between request *starts*, in ms. Combined with `MAX_CONCURRENT`
 *  this keeps us under the common 60/minute public limit. */
const MIN_REQUEST_GAP_MS = 1100;

let activeFetches = 0;
const queue: (() => void)[] = [];
let nextRequestStartAt = 0;

function pumpQueue(): void {
  while (activeFetches < MAX_CONCURRENT && queue.length > 0) {
    const resolve = queue.shift();
    if (!resolve) return;

    activeFetches++;
    const now = Date.now();
    const startAt = Math.max(now, nextRequestStartAt);
    nextRequestStartAt = startAt + MIN_REQUEST_GAP_MS;

    window.setTimeout(resolve, startAt - now);
  }
}

async function withThrottle<T>(fn: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    queue.push(resolve);
    pumpQueue();
  });
  try {
    return await fn();
  } finally {
    activeFetches--;
    pumpQueue();
  }
}

/**
 * Resolve metadata for a Drive video.
 *
 * `folderName` is the immediate parent folder. For episodic content like
 * `[GS]01.mkv`, the filename alone strips to `"01"` — a query so generic that
 * Jikan returns whatever anime contains that number ("Kikaider 01", "Digimon
 * Adventure 02", …). When the filename looks episodic, we fall back to the
 * folder name as the query string so all episodes resolve to the same series.
 */
export async function resolvePoster(
  file: DriveFile,
  folderName?: string,
): Promise<MovieMetadata> {
  const cached = await getCached(file.id);
  if (cached) return cached;

  const normalized = normalizeMovieTitle(file.name);
  const folder = (folderName ?? "").trim();
  const queryTitle =
    folder && isEpisodicFilename(file.name) ? folder : normalized.title;

  const meta = await withThrottle(() =>
    fetchJikan(
      queryTitle,
      normalized.year,
      normalized.quality ?? undefined,
      file,
    ),
  );
  await setCached(meta);
  return meta;
}

interface JikanAnime {
  mal_id: number;
  title?: string;
  title_english?: string | null;
  title_japanese?: string | null;
  images?: {
    jpg?: {
      image_url?: string;
      small_image_url?: string;
      large_image_url?: string;
    };
    webp?: {
      image_url?: string;
      large_image_url?: string;
    };
  };
  type?: string;
  episodes?: number | null;
  status?: string;
  score?: number | null;
  synopsis?: string | null;
  year?: number | null;
  aired?: { from?: string | null };
  genres?: Array<{ name: string }>;
}

async function fetchJikan(
  title: string,
  year: number | null,
  quality: string | undefined,
  file: DriveFile,
): Promise<MovieMetadata> {
  const query = encodeURIComponent(title);
  // `limit=5` keeps the response small; we only need to pick the best match.
  // `sfw=true` filters adult content from search — Nyrima is a personal-cinema
  // tool, not a discovery surface, so this is a safe default.
  const url = `${JIKAN_API}/anime?q=${query}&limit=5&sfw=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return miss(file, title, quality);
    }
    const data = (await res.json()) as { data?: JikanAnime[] };
    const results = data.data ?? [];
    if (results.length === 0) return miss(file, title, quality);

    const hit = year ? pickByYear(results, year) ?? results[0] : results[0];
    const displayTitle =
      hit.title_english?.trim() ||
      hit.title?.trim() ||
      hit.title_japanese?.trim() ||
      title;
    const poster =
      hit.images?.webp?.large_image_url ||
      hit.images?.jpg?.large_image_url ||
      hit.images?.jpg?.image_url;

    return {
      fileId: file.id,
      title: displayTitle,
      year:
        hit.year ??
        (hit.aired?.from
          ? Number(hit.aired.from.slice(0, 4)) || undefined
          : undefined),
      overview: hit.synopsis ?? undefined,
      posterUrl: poster,
      backdropUrl: undefined,
      quality: quality ?? undefined,
      malId: hit.mal_id,
      score: hit.score ?? undefined,
      episodes: hit.episodes ?? undefined,
      mediaType: hit.type ?? undefined,
      genres: (hit.genres ?? []).slice(0, 3).map((g) => g.name),
      status: "ok",
      fetchedAt: Date.now(),
    };
  } catch {
    return miss(file, title, quality);
  }
}

/** Prefer the result whose release year exactly matches the filename's year,
 *  with a ±1 fallback (Jikan's `year` field is the broadcast start year,
 *  which sometimes differs from a Blu-ray release year by ±1). */
function pickByYear(results: JikanAnime[], year: number): JikanAnime | null {
  const exact = results.find((r) => r.year === year);
  if (exact) return exact;
  const nearby = results.find(
    (r) => typeof r.year === "number" && Math.abs((r.year ?? 0) - year) <= 1,
  );
  return nearby ?? null;
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
