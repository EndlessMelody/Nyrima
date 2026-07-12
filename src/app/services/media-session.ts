/**
 * Thin wrapper around the browser MediaSession API — OS/lock-screen media
 * controls and now-playing metadata for both the video player and the music
 * player. Every export no-ops when `navigator.mediaSession` is unavailable,
 * so callers don't need to feature-detect themselves.
 */

export interface MediaSessionArtwork {
  src: string;
  sizes?: string;
  type?: string;
}

export interface MediaSessionMetadataInput {
  title: string;
  artist?: string;
  album?: string;
  artwork?: MediaSessionArtwork[];
}

export type MediaSessionPlaybackState = "playing" | "paused" | "none";

export interface MediaSessionPositionState {
  duration: number;
  position: number;
  playbackRate?: number;
}

type SeekHandler = (details: MediaSessionActionDetails) => void;

export interface MediaSessionHandlers {
  play?: () => void;
  pause?: () => void;
  previoustrack?: () => void;
  nexttrack?: () => void;
  seekbackward?: SeekHandler;
  seekforward?: SeekHandler;
  seekto?: SeekHandler;
  stop?: () => void;
}

const ACTIONS: readonly MediaSessionAction[] = [
  "play",
  "pause",
  "previoustrack",
  "nexttrack",
  "seekbackward",
  "seekforward",
  "seekto",
  "stop",
];

export function isMediaSessionSupported(): boolean {
  return typeof navigator !== "undefined" && "mediaSession" in navigator;
}

/** Sets (or clears, with `null`) the now-playing metadata shown by the OS. */
export function setMediaSessionMetadata(info: MediaSessionMetadataInput | null): void {
  if (!isMediaSessionSupported()) return;
  navigator.mediaSession.metadata = info
    ? new MediaMetadata({
        title: info.title,
        artist: info.artist,
        album: info.album,
        artwork: info.artwork,
      })
    : null;
}

export function setMediaSessionPlaybackState(state: MediaSessionPlaybackState): void {
  if (!isMediaSessionSupported()) return;
  navigator.mediaSession.playbackState = state;
}

/**
 * Registers the given transport-control handlers (omitted/`undefined`
 * actions are explicitly cleared so a stale handler from a previous track
 * can't linger). Returns a function that clears every handler this module
 * manages — call it on unmount/dep-change cleanup.
 */
export function setMediaSessionActionHandlers(handlers: MediaSessionHandlers): () => void {
  if (!isMediaSessionSupported()) return () => {};
  for (const action of ACTIONS) {
    const handler = handlers[action as keyof MediaSessionHandlers];
    try {
      navigator.mediaSession.setActionHandler(
        action,
        handler ? (handler as MediaSessionActionHandler) : null,
      );
    } catch {
      // Some actions (e.g. "stop") throw in browsers that don't recognize them.
    }
  }
  return () => {
    for (const action of ACTIONS) {
      try {
        navigator.mediaSession.setActionHandler(action, null);
      } catch {
        // ignore
      }
    }
  };
}

/** Reports playback position for the OS scrubber. Pass `null` to clear it. */
export function setMediaSessionPositionState(state: MediaSessionPositionState | null): void {
  if (!isMediaSessionSupported()) return;
  if (typeof navigator.mediaSession.setPositionState !== "function") return;
  try {
    if (!state || !Number.isFinite(state.duration) || state.duration <= 0) {
      navigator.mediaSession.setPositionState();
      return;
    }
    navigator.mediaSession.setPositionState({
      duration: state.duration,
      position: Math.min(Math.max(state.position, 0), state.duration),
      playbackRate:
        state.playbackRate && state.playbackRate > 0 ? state.playbackRate : 1,
    });
  } catch {
    // setPositionState throws if e.g. position > duration mid-seek; best-effort.
  }
}
