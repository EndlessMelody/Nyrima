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

/** Prefix used to namespace folder-scoped (series) cache entries inside the
 *  same `metadataCache.v2` map that holds per-file entries. The shape
 *  remains `MovieMetadata` — `fileId` just stores this synthetic key. */
const SERIES_CACHE_PREFIX = "series:";

/** Build the cache key for a folder/series query. Lower-cased + collapsed
 *  whitespace so "Bokutachi no Remake" and "bokutachi  no remake" share an
 *  entry. */
export function seriesCacheKey(folderName: string): string {
  return SERIES_CACHE_PREFIX + folderName.trim().toLowerCase().replace(/\s+/g, " ");
}

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

/**
 * Resolve a *series-level* poster keyed purely by the folder name. This is
 * the right entry point for surfaces that advertise the series rather than a
 * specific file (library cards on the lobby, the featured hero, episode
 * thumbnail fallbacks). Differences from `resolvePoster`:
 *
 *   - Cache is keyed by folder name (with a "series:" prefix) rather than
 *     by Drive fileId, so every episode in the library shares one cached
 *     query result instead of burning 12 cache slots.
 *   - Works on folders with zero videos (returns a miss but still bumps the
 *     cache so we don't re-query on every lobby visit).
 *   - The synthetic `MovieMetadata.fileId` carries the cache key, so callers
 *     can re-read it with `getCached(seriesCacheKey(folder))`.
 */
export async function resolveSeriesPoster(
  folderName: string,
): Promise<MovieMetadata> {
  const folder = (folderName ?? "").trim();
  if (!folder) {
    return {
      fileId: seriesCacheKey(""),
      title: "",
      status: "miss",
      fetchedAt: Date.now(),
    };
  }
  const key = seriesCacheKey(folder);
  const cached = await getCached(key);
  if (cached) return cached;

  // Build a synthetic DriveFile so `fetchJikan` can stamp `fileId = key`.
  const synthetic: DriveFile = {
    id: key,
    name: folder,
    mimeType: "application/vnd.google-apps.folder",
  };
  const meta = await withThrottle(() =>
    fetchJikan(folder, null, undefined, synthetic),
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
  // `limit=10` (up from 5) gives the similarity picker more options to score
  // against — Jikan's relevance order isn't always the closest title match
  // for short queries. `sfw=true` filters adult content from search.
  const url = `${JIKAN_API}/anime?q=${query}&limit=10&sfw=true`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      return miss(file, title, quality);
    }
    const data = (await res.json()) as { data?: JikanAnime[] };
    const results = data.data ?? [];
    if (results.length === 0) return miss(file, title, quality);

    // Pick strategy:
    //   1. If we have a year, prefer the year-matching candidate.
    //   2. Otherwise, score every candidate by title similarity to the query
    //      and take the highest. Jikan's default relevance order routinely
    //      returns wrong matches for short queries like "Bokutachi no Remake"
    //      — its index favours older/popular anime, so a query for a recent
    //      lesser-known series can land on something unrelated at index 0.
    //
    // Notably we do NOT fall back to `results[0]` when both picks miss: for
    // niche queries Jikan's relevance ranking returns popular unrelated
    // anime (e.g. "Gimai Seikatsu" → Doraemon), and a confidently wrong
    // poster is worse than no poster — the library card's initials
    // fallback (e.g. "GS") is honest and gets re-resolved later.
    const yearHit = year ? pickByYear(results, year) : null;
    const simHit = pickBySimilarity(results, title);
    const hit = yearHit ?? simHit;
    if (!hit) return miss(file, title, quality);
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

/**
 * Pick the candidate whose title is closest to the query string. Compares
 * the query against each of MAL's three title fields (default / english /
 * japanese romaji) and takes the highest score. Used to overrule Jikan's
 * default relevance ranking, which often surfaces a high-popularity
 * unrelated match ahead of an exact hit for niche queries.
 *
 * Returns `null` when no candidate scores above the minimum threshold,
 * letting the caller fall back to `results[0]`.
 */
function pickBySimilarity(
  results: JikanAnime[],
  query: string,
): JikanAnime | null {
  const q = normaliseForCompare(query);
  if (!q) return null;
  let best: JikanAnime | null = null;
  let bestScore = 0;
  for (const r of results) {
    const candidates = [r.title, r.title_english, r.title_japanese].filter(
      (s): s is string => typeof s === "string" && s.length > 0,
    );
    const score = Math.max(
      0,
      ...candidates.map((c) => similarity(q, normaliseForCompare(c))),
    );
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  // 0.55 = "mostly the same string with a few char/word swaps". Below that
  // the candidate is likely a different show — fall back to results[0]
  // (Jikan's relevance pick) rather than ship a misleading "best" match.
  return bestScore >= 0.55 ? best : null;
}

/** Lower-case, strip punctuation, collapse whitespace. Makes "Bokutachi no
 *  Remake" and "bokutachi-no-remake" compare equal. */
function normaliseForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Jaccard similarity over token sets, with a length-ratio cap so a query
 *  doesn't "match" a strict superset by accident (e.g. "Naruto" matching
 *  "Naruto Shippuden Sayonara…" perfectly when the query was just "naruto"). */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const tokensA = new Set(a.split(" "));
  const tokensB = new Set(b.split(" "));
  let inter = 0;
  for (const t of tokensA) if (tokensB.has(t)) inter++;
  const union = tokensA.size + tokensB.size - inter;
  if (union === 0) return 0;
  const jaccard = inter / union;
  // Length-ratio penalty: candidates that are much longer than the query
  // (lots of extra words) get scored down so an exact 3-word query doesn't
  // mistakenly match a 10-word title that happens to contain all 3.
  const lenA = tokensA.size;
  const lenB = tokensB.size;
  const ratio = Math.min(lenA, lenB) / Math.max(lenA, lenB);
  return jaccard * (0.5 + 0.5 * ratio);
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
