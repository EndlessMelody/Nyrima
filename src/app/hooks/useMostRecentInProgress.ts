import { useMemo } from "react";
import type { PlaybackPosition } from "@shared/types";
import { isInProgress } from "../services/storage";
import { usePlaybackPositions } from "./usePlaybackPositions";

/**
 * The single most recently-updated in-progress playback position, or null.
 * Skips positions without a `folderId` (legacy rows from before playback
 * saves stamped it) so callers never build a broken `/play//fileId` link.
 */
export function useMostRecentInProgress(): PlaybackPosition | null {
  const [positions] = usePlaybackPositions();
  return useMemo(() => {
    const inProgress = Object.values(positions).filter(
      (p) => isInProgress(p) && !!p.folderId,
    );
    if (inProgress.length === 0) return null;
    return inProgress.reduce((best, p) =>
      (p.updatedAt ?? 0) > (best.updatedAt ?? 0) ? p : best,
    );
  }, [positions]);
}
