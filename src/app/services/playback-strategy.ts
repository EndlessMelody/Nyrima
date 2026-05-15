/**
 * Playback strategy — pick between native <video> and the MSE remux pipeline.
 *
 * Why this exists:
 *   MKV files used to be force-routed to MSE because the native attempts
 *   wasted Drive Range requests on files Chrome couldn't decode. With the
 *   subtitle extractor now decoupled from remux, the calculus flipped:
 *   most H.264+AAC MKVs play natively in ~1 s, and one wasted Range on the
 *   HEVC-shaped minority is cheaper than tens of seconds of always-on remux.
 *
 * Auto mode flow (caller's responsibility):
 *   1. Ask `decideInitialMode` what to try.
 *   2. If `native`, set the direct stream URL and arm `NATIVE_WATCHDOG_MS`.
 *   3. On `canplay` → cancel watchdog, call `rememberMode(fileId, "native")`.
 *   4. On watchdog fire or `<video>` decode/src error → switch to MSE and
 *      call `rememberMode(fileId, "mse-remux")` so we skip the watchdog next
 *      time the same file is opened.
 */

import { MAX_PLAYBACK_ENGINE_ENTRIES, STORAGE_KEYS } from "@shared/constants";
import type { DriveFile } from "@shared/types";

export type PlaybackStrategy =
  | "auto"
  | "native-first"
  | "force-native"
  | "force-remux";

export type PlaybackMode = "native" | "mse-remux";

export interface PlaybackOutcome {
  mode: PlaybackMode;
  /** Epoch ms — used purely for LRU eviction. */
  at: number;
}

export interface PlaybackDecision {
  mode: PlaybackMode;
  reason:
    | "user-forced"
    | "remembered"
    | "default-native"
    | "no-direct-url";
}

/**
 * Time the native attempt is allowed to reach `canplay` before we give up and
 * route to MSE. 10 s is forgiving on slow links yet short enough to escape a
 * stuck HEVC file within the user's "feels broken" threshold.
 */
export const NATIVE_WATCHDOG_MS = 10_000;

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

/**
 * Pick the initial playback mode for a file. Pure — caller pre-fetches the
 * remembered mode (async) so this stays trivially testable.
 *
 * `_file` is reserved for future codec-sniff routing; today the only signals
 * are user override + per-file memory.
 */
export function decideInitialMode(
  _file: DriveFile,
  strategy: PlaybackStrategy,
  remembered: PlaybackMode | null,
): PlaybackDecision {
  if (strategy === "force-remux") {
    return { mode: "mse-remux", reason: "user-forced" };
  }
  if (strategy === "force-native") {
    return { mode: "native", reason: "user-forced" };
  }
  if (remembered) {
    return { mode: remembered, reason: "remembered" };
  }
  return { mode: "native", reason: "default-native" };
}

/** Strategies that allow native → MSE fallback after the watchdog or error. */
export function allowsFallback(strategy: PlaybackStrategy): boolean {
  return strategy === "auto" || strategy === "native-first";
}

// ---------------------------------------------------------------------------
// Per-file LRU memory (chrome.storage.local)
// ---------------------------------------------------------------------------

type EngineCacheMap = Record<string, PlaybackOutcome>;

async function readCache(): Promise<EngineCacheMap> {
  try {
    const obj = await chrome.storage.local.get(
      STORAGE_KEYS.PLAYBACK_ENGINE_CACHE,
    );
    return (
      (obj[STORAGE_KEYS.PLAYBACK_ENGINE_CACHE] as
        | EngineCacheMap
        | undefined) ?? {}
    );
  } catch {
    return {};
  }
}

async function writeCache(cache: EngineCacheMap): Promise<void> {
  const entries = Object.entries(cache);
  let toStore = cache;
  if (entries.length > MAX_PLAYBACK_ENGINE_ENTRIES) {
    // LRU prune: keep MAX newest by `at`.
    entries.sort((a, b) => b[1].at - a[1].at);
    toStore = Object.fromEntries(entries.slice(0, MAX_PLAYBACK_ENGINE_ENTRIES));
  }
  try {
    await chrome.storage.local.set({
      [STORAGE_KEYS.PLAYBACK_ENGINE_CACHE]: toStore,
    });
  } catch {
    // Best-effort persistence — never block playback on it.
  }
}

export async function getRememberedMode(
  fileId: string,
): Promise<PlaybackMode | null> {
  const cache = await readCache();
  return cache[fileId]?.mode ?? null;
}

export async function rememberMode(
  fileId: string,
  mode: PlaybackMode,
): Promise<void> {
  const cache = await readCache();
  cache[fileId] = { mode, at: Date.now() };
  await writeCache(cache);
}

export async function forgetMode(fileId: string): Promise<void> {
  const cache = await readCache();
  if (!cache[fileId]) return;
  delete cache[fileId];
  await writeCache(cache);
}
