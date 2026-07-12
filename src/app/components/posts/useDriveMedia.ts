/**
 * Resolve a Drive `fileId` to a blob object URL for `<img>`/inline preview,
 * shared between the editor's `DriveImageBlock` and the reader's image
 * view — both need the same "small file → blob URL" resolution, just in
 * different components.
 *
 * Module-level LRU cache + in-flight de-dup, keyed by fileId, so:
 *   - Two blocks referencing the same fileId (e.g. re-used cover art)
 *     share one download.
 *   - React 18 StrictMode's dev double-mount doesn't cancel or duplicate
 *     the underlying fetch — the effect cleanup only stops a stale
 *     `setState`, it never aborts `downloadFile` (see the drive-load
 *     StrictMode gotcha: aborting on cleanup breaks the live mount).
 */

import { useEffect, useState } from "react";
import { downloadFile } from "../../services/drive-api";

const MAX_CACHE_ENTRIES = 60;

const cache = new Map<string, string>(); // fileId -> object URL, insertion order = LRU order
const inflight = new Map<string, Promise<string>>();

export interface DriveMediaState {
  url: string | null;
  loading: boolean;
  error: string | null;
}

export function useDriveMedia(fileId: string | undefined): DriveMediaState {
  const [state, setState] = useState<DriveMediaState>(() => initialState(fileId));

  useEffect(() => {
    if (!fileId) {
      setState({ url: null, loading: false, error: null });
      return;
    }
    if (cache.has(fileId)) {
      touch(fileId);
      setState({ url: cache.get(fileId)!, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ url: null, loading: true, error: null });

    const task = inflight.get(fileId) ?? resolveAndCache(fileId);
    inflight.set(fileId, task);
    task
      .then((url) => {
        if (!cancelled) setState({ url, loading: false, error: null });
      })
      .catch((e) => {
        if (!cancelled) {
          setState({
            url: null,
            loading: false,
            error: e instanceof Error ? e.message : "Couldn't load image.",
          });
        }
      })
      .finally(() => {
        if (inflight.get(fileId) === task) inflight.delete(fileId);
      });

    return () => {
      cancelled = true;
    };
  }, [fileId]);

  return state;
}

function initialState(fileId: string | undefined): DriveMediaState {
  if (fileId && cache.has(fileId)) {
    return { url: cache.get(fileId)!, loading: false, error: null };
  }
  return { url: null, loading: !!fileId, error: null };
}

async function resolveAndCache(fileId: string): Promise<string> {
  const blob = await downloadFile(fileId);
  const url = URL.createObjectURL(blob);
  cache.set(fileId, url);
  evictIfNeeded();
  return url;
}

function touch(fileId: string): void {
  const url = cache.get(fileId);
  if (!url) return;
  cache.delete(fileId);
  cache.set(fileId, url);
}

function evictIfNeeded(): void {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    const url = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (url) URL.revokeObjectURL(url);
  }
}
