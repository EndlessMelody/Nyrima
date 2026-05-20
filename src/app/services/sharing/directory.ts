/**
 * Phase 4.4 — bootstrap directory client.
 *
 * Fetches a curated `DirectoryEntry[]` from a public GitHub raw URL.
 * Caches it in chrome.storage.local on a 24h TTL so the Discover rail
 * doesn't pull the JSON on every Social-hub mount.
 *
 * Why GitHub raw + manual PR moderation: spam-resistant by virtue of the
 * merge gate, no infra to run, version-controlled history. The trade-off
 * is opt-in friction — users copy-paste a JSON snippet into a GitHub
 * issue and wait for review. The `RequestListingDialog` generates the
 * snippet so users don't have to figure out the schema.
 *
 * Graceful 404: the registry repo may not exist yet on early builds.
 * `fetchDirectory` treats a 404 (or any network error) as "empty
 * directory" rather than surfacing a hard error to the UI — the People
 * tab still works, just without a Discover rail.
 */

import {
  DIRECTORY_CACHE_TTL_MS,
  NYRIMA_DIRECTORY_URL,
  SHARE_HANDLE_PATTERN,
  STORAGE_KEYS,
} from "@shared/constants";
import { isDriveId } from "@shared/drive-id";
import type { DirectoryEntry } from "@shared/types";

const MAX_DIRECTORY_ENTRIES = 200;
const MAX_DIRECTORY_NAME_CHARS = 80;
const MAX_DIRECTORY_BIO_CHARS = 240;
const MAX_DIRECTORY_TAGS = 8;
const MAX_DIRECTORY_TAG_CHARS = 32;
const MAX_DIRECTORY_URL_CHARS = 2048;

interface CachedDirectory {
  /** Epoch ms of the last successful fetch. */
  fetchedAt: number;
  /** Source URL — invalidates the cache if NYRIMA_DIRECTORY_URL ever
   *  changes (e.g., extension upgrade pointing at a new repo). */
  source: string;
  entries: DirectoryEntry[];
}

/**
 * Resolve the directory: cached if fresh, otherwise fetch + cache.
 *
 * Returns `[]` on any error (404, parse failure, offline). Callers don't
 * need to handle exceptions — the empty case is the same shape as a
 * legitimately-empty directory.
 */
export async function fetchDirectory(opts?: {
  force?: boolean;
}): Promise<DirectoryEntry[]> {
  if (!opts?.force) {
    const cached = await readCache();
    if (cached && Date.now() - cached.fetchedAt < DIRECTORY_CACHE_TTL_MS) {
      return cached.entries;
    }
  }
  try {
    const res = await fetch(NYRIMA_DIRECTORY_URL, {
      // No credentials — public file, anonymous request.
      credentials: "omit",
      // Bypass HTTP cache so a fresh PR merge shows up at the next TTL
      // boundary rather than waiting on CDN edge cache (which can be 5
      // minutes on raw.githubusercontent.com).
      cache: "no-store",
    });
    if (!res.ok) {
      // 404 = "repo or file doesn't exist yet" — treat as empty so the
      // UI surfaces a friendly note. Persist the empty result so we
      // don't re-hit GitHub on every page nav within the TTL window.
      await writeCache({ fetchedAt: Date.now(), source: NYRIMA_DIRECTORY_URL, entries: [] });
      return [];
    }
    const raw = (await res.json()) as unknown;
    const entries = sanitizeDirectory(raw);
    await writeCache({
      fetchedAt: Date.now(),
      source: NYRIMA_DIRECTORY_URL,
      entries,
    });
    return entries;
  } catch {
    // Network failure — return whatever cache we have rather than
    // blanking the rail. Stale-while-error beats vanishing UI.
    const cached = await readCache();
    return cached?.entries ?? [];
  }
}

/** Read the cache without triggering a network fetch. Useful for first
 *  paint before the async `fetchDirectory()` resolves. */
export async function getCachedDirectory(): Promise<DirectoryEntry[]> {
  const cached = await readCache();
  return cached?.entries ?? [];
}

/** Wipe the cached directory. Called by account-reset for safety; not
 *  strictly required since the directory is public anyway. */
export async function clearDirectoryCache(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.DIRECTORY_CACHE);
}

// ---------------------------------------------------------------------------

async function readCache(): Promise<CachedDirectory | null> {
  const obj = await chrome.storage.local.get(STORAGE_KEYS.DIRECTORY_CACHE);
  const v = obj[STORAGE_KEYS.DIRECTORY_CACHE] as CachedDirectory | undefined;
  if (!v) return null;
  // If the URL changed (extension upgrade pointing at a new registry),
  // drop the cache so the next read pulls from the new source.
  if (v.source !== NYRIMA_DIRECTORY_URL) return null;
  return v;
}

async function writeCache(value: CachedDirectory): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.DIRECTORY_CACHE]: value });
}

/** Filter + shape the raw JSON into `DirectoryEntry[]`. Anything that
 *  doesn't look like a v=1 entry is dropped silently — protects the UI
 *  from a malformed publish without needing the registry repo to be
 *  schema-perfect. Exported for tests. */
export function sanitizeDirectory(raw: unknown): DirectoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: DirectoryEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (out.length >= MAX_DIRECTORY_ENTRIES) break;
    if (
      !item ||
      typeof item !== "object" ||
      (item as { v?: unknown }).v !== 1
    ) {
      continue;
    }
    const e = item as Partial<DirectoryEntry>;
    if (
      typeof e.handle !== "string" ||
      typeof e.folderId !== "string" ||
      typeof e.addedAt !== "string"
    ) {
      continue;
    }
    if (
      !SHARE_HANDLE_PATTERN.test(e.handle) ||
      !isDriveId(e.folderId) ||
      !isIsoDate(e.addedAt)
    ) {
      continue;
    }
    if (seen.has(e.handle)) continue;
    seen.add(e.handle);
    const tags = sanitizeTags(e.tags);
    out.push({
      v: 1,
      handle: e.handle,
      name: sanitizeText(e.name, MAX_DIRECTORY_NAME_CHARS),
      folderId: e.folderId,
      avatarUrl: sanitizeAvatarUrl(e.avatarUrl),
      bio: sanitizeText(e.bio, MAX_DIRECTORY_BIO_CHARS),
      tags,
      addedAt: e.addedAt,
    });
  }
  return out;
}

function sanitizeText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxChars);
}

function sanitizeTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => /^[a-z0-9][a-z0-9 _-]{0,31}$/.test(t))
    .slice(0, MAX_DIRECTORY_TAGS)
    .map((t) => t.slice(0, MAX_DIRECTORY_TAG_CHARS));
  return tags.length > 0 ? tags : undefined;
}

function sanitizeAvatarUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > MAX_DIRECTORY_URL_CHARS) {
    return undefined;
  }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    const host = url.hostname.toLowerCase();
    const allowed =
      host.endsWith(".googleusercontent.com") ||
      host.endsWith(".githubusercontent.com");
    return allowed ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
