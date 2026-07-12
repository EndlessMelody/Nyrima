import type { Chapter } from "./landingSections";

/**
 * Reading-progress tracking: which subsections the visitor has opened, and
 * whether they've already seen the one-time completion reward — persisted
 * across visits (`nyrima.vn.progress`, vnControls-style storage).
 *
 * Pure data + pure selectors only; `useLandingSections` owns the React state
 * and read/write-through to storage.
 */

export const PROGRESS_STORAGE_KEY = "nyrima.vn.progress";

type ProgressStorage = Pick<Storage, "getItem" | "setItem">;

export interface VNProgress {
  visitedKeys: string[];
  rewardSeen: boolean;
}

export const DEFAULT_VN_PROGRESS: VNProgress = {
  visitedKeys: [],
  rewardSeen: false,
};

export interface CompletionStatus {
  visitedCount: number;
  total: number;
  percent: number;
  isComplete: boolean;
}

/** One key per subsection across all chapters (e.g. "welcome/what") — the
 *  unit of "has the visitor read this". */
export function trackableKeys(chapters: Chapter[]): string[] {
  return chapters.flatMap((chapter) =>
    chapter.subsections.map((sub) => `${chapter.id}/${sub.id}`),
  );
}

export function computeCompletion(
  visited: ReadonlySet<string>,
  chapters: Chapter[],
): CompletionStatus {
  const keys = trackableKeys(chapters);
  const total = keys.length;
  const visitedCount = keys.filter((key) => visited.has(key)).length;
  const percent = total === 0 ? 0 : Math.round((visitedCount / total) * 100);
  return { visitedCount, total, percent, isComplete: total > 0 && visitedCount >= total };
}

/**
 * True if `nodeKey` is a node the visitor has already been shown — the intro,
 * the index (incl. revisit greetings), a visited subsection, or a chapter's
 * own intro once that chapter has been opened. Used to gate Skip: it should
 * only fast-forward through nodes the visitor isn't seeing for the first time.
 */
export function isNodeSeen(nodeKey: string, visited: ReadonlySet<string>): boolean {
  if (nodeKey === "intro" || nodeKey === "index" || nodeKey.startsWith("index:revisit-")) {
    return true;
  }
  if (visited.has(nodeKey)) return true;
  if (nodeKey.endsWith("/intro")) {
    return visited.has(nodeKey.slice(0, -"/intro".length));
  }
  return false;
}

function getStorage(storage?: ProgressStorage): ProgressStorage | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function normalizeVNProgress(value: unknown): VNProgress {
  if (!value || typeof value !== "object") return DEFAULT_VN_PROGRESS;
  const raw = value as Partial<VNProgress>;
  const visitedKeys = Array.isArray(raw.visitedKeys)
    ? raw.visitedKeys.filter((key): key is string => typeof key === "string")
    : DEFAULT_VN_PROGRESS.visitedKeys;
  const rewardSeen = typeof raw.rewardSeen === "boolean" ? raw.rewardSeen : DEFAULT_VN_PROGRESS.rewardSeen;
  return { visitedKeys, rewardSeen };
}

export function readStoredProgress(storage?: ProgressStorage): VNProgress {
  try {
    const raw = getStorage(storage)?.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return DEFAULT_VN_PROGRESS;
    return normalizeVNProgress(JSON.parse(raw));
  } catch {
    return DEFAULT_VN_PROGRESS;
  }
}

export function writeStoredProgress(progress: VNProgress, storage?: ProgressStorage) {
  try {
    getStorage(storage)?.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // localStorage can be unavailable in private contexts; the UI state still works.
  }
}
