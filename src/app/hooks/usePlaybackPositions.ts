import { useEffect, useState } from "react";
import type { PlaybackPosition } from "@shared/types";
import { getPlaybackPositionMap } from "../services/storage";

/**
 * Loads all stored playback positions once on mount (and again when `key`
 * changes) and returns them keyed by fileId. `setPositions` is exposed so
 * callers can optimistically update after savePlaybackPosition.
 */
export function usePlaybackPositions(key: unknown = null) {
  const [positions, setPositions] = useState<Record<string, PlaybackPosition>>(
    {},
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const map = await getPlaybackPositionMap();
      if (!cancelled) setPositions(map);
    })();
    return () => {
      cancelled = true;
    };
  }, [key]);

  return [positions, setPositions] as const;
}
