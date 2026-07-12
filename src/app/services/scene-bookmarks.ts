/**
 * Scene bookmarks — lightweight, real persistence for "bookmark this moment".
 *
 * The video player has no server-side bookmark store, so we keep these in
 * localStorage keyed by the Drive file id. Each entry is a real timestamp the
 * user captured while watching; nothing here is synthesized. The watch-room
 * Bookmark button writes entries; the Notes tab lists them and jumps back.
 *
 * Storage shape: one JSON array per file under `nyrima:scene-bookmarks:<fileId>`.
 * Capped at MAX_PER_FILE newest-first so a long binge can't bloat the quota.
 */

export interface SceneBookmark {
  /** Stable id for list keys + removal. */
  id: string;
  /** Captured playback position, in seconds. */
  timeSec: number;
  /** Epoch ms when the bookmark was created. */
  createdAt: number;
}

const KEY_PREFIX = "nyrima:scene-bookmarks:";
const MAX_PER_FILE = 50;

function keyFor(fileId: string): string {
  return `${KEY_PREFIX}${fileId}`;
}

function hasStorage(): boolean {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
}

function readRaw(fileId: string): SceneBookmark[] {
  if (!fileId || !hasStorage()) return [];
  try {
    const raw = localStorage.getItem(keyFor(fileId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (b): b is SceneBookmark =>
        b &&
        typeof b.id === "string" &&
        typeof b.timeSec === "number" &&
        Number.isFinite(b.timeSec),
    );
  } catch {
    return [];
  }
}

function writeRaw(fileId: string, bookmarks: SceneBookmark[]): void {
  if (!fileId || !hasStorage()) return;
  try {
    if (bookmarks.length === 0) {
      localStorage.removeItem(keyFor(fileId));
    } else {
      localStorage.setItem(keyFor(fileId), JSON.stringify(bookmarks));
    }
  } catch {
    // Quota or serialization failure — bookmarks are best-effort, so swallow.
  }
}

/** All bookmarks for a file, sorted by playback time ascending. */
export function getSceneBookmarks(fileId: string): SceneBookmark[] {
  return readRaw(fileId).sort((a, b) => a.timeSec - b.timeSec);
}

/**
 * Save the current moment. De-dupes timestamps within 1s so a double-click
 * doesn't stack near-identical entries. Returns the updated, sorted list.
 */
export function addSceneBookmark(
  fileId: string,
  timeSec: number,
): SceneBookmark[] {
  if (!fileId || !Number.isFinite(timeSec) || timeSec < 0) {
    return getSceneBookmarks(fileId);
  }
  const existing = readRaw(fileId);
  if (existing.some((b) => Math.abs(b.timeSec - timeSec) < 1)) {
    return getSceneBookmarks(fileId);
  }
  const entry: SceneBookmark = {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timeSec: Math.round(timeSec * 100) / 100,
    createdAt: Date.now(),
  };
  const next = [entry, ...existing]
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, MAX_PER_FILE);
  writeRaw(fileId, next);
  return getSceneBookmarks(fileId);
}

/** Remove a bookmark by id. Returns the updated, sorted list. */
export function removeSceneBookmark(
  fileId: string,
  id: string,
): SceneBookmark[] {
  const next = readRaw(fileId).filter((b) => b.id !== id);
  writeRaw(fileId, next);
  return getSceneBookmarks(fileId);
}
