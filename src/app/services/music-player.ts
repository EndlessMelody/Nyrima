export const MUSIC_LIBRARY_ROUTE = "/library/music";
export const MUSIC_PLAYER_ROUTE_PREFIX = "/music/player";

export type MusicPlayerBackState = {
  sourceRoute?: unknown;
  from?: unknown;
  previousSection?: unknown;
};

export type AudioPreset =
  | "Music"
  | "Vocal"
  | "Anime OST"
  | "Night"
  | "Flat"
  | "Custom";

export type PlaybackLoadStatus = "idle" | "loading" | "ready" | "error";

export const EQ_FREQUENCIES = [
  "31",
  "62",
  "125",
  "250",
  "500",
  "1k",
  "2k",
  "4k",
  "8k",
  "16k",
] as const;

export const DEFAULT_EQ_VALUES = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

const EQ_PRESETS: Record<AudioPreset, number[]> = {
  Music: [3, 4, 3, 2, 1, 1, 2, 3, 3, 2],
  Vocal: [-1, 0, 1, 2, 3, 4, 4, 3, 1, 0],
  "Anime OST": [2, 3, 4, 3, 1, 2, 4, 5, 4, 3],
  Night: [-3, -2, -1, 0, 1, 1, 0, -1, -2, -3],
  Flat: DEFAULT_EQ_VALUES,
  Custom: DEFAULT_EQ_VALUES,
};

export function resolveMusicPlayerBackTarget(
  state: MusicPlayerBackState | null | undefined,
): string {
  const candidates = [state?.sourceRoute, state?.from, state?.previousSection];
  const safe = candidates.find(isSafeInternalBackTarget);
  return safe ?? MUSIC_LIBRARY_ROUTE;
}

export function getEqPresetValues(preset: string): number[] {
  const values = EQ_PRESETS[preset as AudioPreset] ?? DEFAULT_EQ_VALUES;
  return [...values];
}

export function formatPlaybackClock(seconds: number | undefined): string {
  if (!Number.isFinite(seconds) || !seconds || seconds <= 0) return "0:00";
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export function shouldDeferPlaybackRequest(status: PlaybackLoadStatus): boolean {
  return status === "idle" || status === "loading";
}

export function shouldStartPlaybackImmediately(
  status: PlaybackLoadStatus,
  hasPlayableSource: boolean,
): boolean {
  return status === "ready" && hasPlayableSource;
}

export function volumePercentToElementVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / 100));
}

function isSafeInternalBackTarget(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.startsWith(MUSIC_PLAYER_ROUTE_PREFIX)) return false;
  return true;
}
