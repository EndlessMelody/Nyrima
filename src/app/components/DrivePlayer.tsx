/**
 * DrivePlayer — custom video player chrome.
 *
 * Replaces the browser's native <video controls> with a VLC-flavored UI:
 *   - Sakura→violet gradient progress bar with monospace timecode
 *   - Center "resume" knob that breathes when paused
 *   - Per-language subtitle picker + speed picker popups
 *   - Volume slider that unfolds on hover
 *   - Keyboard shortcuts (space / J·L / arrows / M / F / C)
 *   - Auto-hides the HUD after ~2.5s of mouse inactivity while playing
 *   - Reports playback failures to the parent via onMediaError so the page
 *     can render the typed DriveAccessError card.
 *
 * NOTE: We intentionally do not set crossOrigin on the <video>. Drive's
 * ?alt=media&key=... response doesn't include CORS headers permissive
 * enough for chrome-extension://; with crossOrigin set, the element
 * refuses to load. Without it the browser plays the resource as opaque,
 * which is fine for playback (we don't need canvas access).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import cn from "classnames";
import "./DrivePlayer.scss";
import { SubtitleOverlay } from "./SubtitleOverlay";
import { JassubOverlay } from "./JassubOverlay";
import { PgsOverlay } from "./PgsOverlay";
import { SettingsPopover, type PlayerAudioTrack } from "./SettingsPopover";
import type { SubCue } from "../services/subtitles";
import { EMPTY_CUES } from "../services/subtitles";
import { formatTimecode } from "../services/formatters";
import { markPlayback } from "../services/playback-telemetry";
import { useSettingsStore } from "../stores/settings-store";
import { fontStackFor } from "../services/subtitle-font";

export interface SubtitleTrack {
  id: string;
  lang: string;
  label: string;
  cues: SubCue[];
  imageBased?: boolean;
  source?: "embedded" | "external";
  format?: "ass" | "ssa" | "srt" | "vtt" | "text" | "image";
  codecId?: string;
  /**
   * Raw ASS/SSA source. Tracks that set this also set `assRenderer: "jassub"`
   * to opt into libass-compatible rendering (typesetting, karaoke, positions,
   * fonts). Both external `.ass` files and embedded MKV ASS use this path —
   * the latter via the reconstituted script from extractMkvSubtitles.
   */
  assSource?: string;
  assRenderer?: "jassub";
  /**
   * Decoded PGS compositions for Blu-ray bitmap tracks. When present, the
   * player swaps SubtitleOverlay for PgsOverlay and ignores `cues`. Cleared
   * while extraction is still streaming so the picker doesn't expose a
   * half-built track.
   */
  pgsCompositions?: import("../services/pgs-renderer").PgsComposition[];
}

interface Props {
  src: string;
  subtitleTracks: SubtitleTrack[];
  title?: string;
  /**
   * Seconds to seek to once metadata is ready. Use this instead of grabbing
   * the <video> ref from the parent so the player stays encapsulated.
   */
  initialSeek?: number;
  /**
   * Skip the "Resume?" pill and apply `initialSeek` silently. PlayerPage sets
   * this for navigations that aren't a fresh-open (e.g. a dub-switch reload
   * where the user expects to continue at the same spot, not see a 3.5 s
   * count-down before the seek fires).
   */
  silentResume?: boolean;
  /** Called when the <video> emits a fatal error. */
  onMediaError?: (err: MediaError | null) => void;
  /** Called once metadata is known. */
  onLoadedMetadata?: (duration: number) => void;
  /** Called every timeupdate; useful for persisting playback position. */
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  /**
   * Fires the first time the browser reports `canplay` for the current src.
   * Used by the player page to log a startup-timing summary.
   */
  onCanPlay?: () => void;
  /**
   * Fires the first time `requestVideoFrameCallback` reports a painted frame
   * for the current src. Telemetry only — falls back to silent no-op when the
   * API is missing (older WebView).
   */
  onFirstFrame?: () => void;
  /** Exposes the raw <video> element so the parent can attach MSE. Setting
   *  this prop also tells DrivePlayer to leave the `src` attribute unset
   *  (MSE owns it) and disables the timeline preview, so it's NOT a general
   *  observer hook — use `onVideoElement` below for that. */
  onVideoRef?: (el: HTMLVideoElement | null) => void;
  /** Pure observer hook — fires with the current <video> element on mount
   *  and again with `null` on unmount. Unlike `onVideoRef` this does not
   *  alter how DrivePlayer manages the `src` attribute, so it's safe to
   *  use from features like screenshot capture that just need to read off
   *  the live element. */
  onVideoElement?: (el: HTMLVideoElement | null) => void;
  nextVideo?: {
    fileId: string;
    title: string;
    /** Display title produced by the folder-aware title parser
     *  (e.g. "GIMAI SEIKATSU - EP07"). Falls back to `title` when missing. */
    displayTitle?: string;
    /** Folder cover poster URL (from the user-placed `Poster.*` in the
     *  Drive folder) for the Next-up card. Card still renders without it —
     *  image just stays blank. */
    posterUrl?: string;
  } | null;
  prevVideo?: { fileId: string; title: string } | null;
  onNext?: () => void;
  onPrev?: () => void;
  /**
   * Audio tracks parsed from the MKV header. When provided, this list — not
   * the browser's `HTMLVideoElement.audioTracks` — is the source of truth for
   * the SettingsPopover audio picker. The browser list is still flipped on
   * pick to switch the active dub for native playback; in MSE mode the parent
   * additionally re-mounts the controller via `onPickAudioTrackNumber` because
   * fMP4 init segments aren't re-writable in place.
   */
  mkvAudioTracks?: import("../services/mkv-subtitles").MkvAudioTrack[];
  /**
   * Currently selected MKV audio TrackNumber. Drives the "active" pill in the
   * picker — and matches what the MSE controller was started with.
   */
  selectedMkvAudioTrackNumber?: number | null;
  /**
   * Fired when the user picks a different MKV audio track from the popover.
   * The parent owns the consequences: in native mode it's a no-op (the
   * `.enabled` flip below already moved the browser to the new dub); in MSE
   * mode it must destroy and re-start the controller with the new track.
   */
  onPickAudioTrackNumber?: (trackNumber: number) => void;
  /** Theatre-mode state, owned by the parent page. When provided, the player
   *  exposes a toggle button in the bottom-right control cluster. */
  theatreMode?: boolean;
  onToggleTheatre?: () => void;
  /** Optional image URL the player samples for an ambient bloom around the
   *  frame. We can't sample the <video> directly because Drive's media
   *  endpoint doesn't send CORS headers (canvas would be tainted), so this
   *  takes a CORS-friendly poster URL — typically the cached MAL artwork.
   *  Silently no-ops if the URL fails to load or the canvas read is blocked. */
  ambientSourceUrl?: string;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SCALE_STEP = 0.1;
const SCALE_MIN = 0.5;
const SCALE_MAX = 2.0;
// How long before the end of the episode the Next-up card appears. Long
// enough to be noticed during credits; short enough not to compete with the
// closing sign typesetting earlier in the outro.
const NEXT_UP_THRESHOLD_SEC = 20;
// Auto-resume delay for the resume pill. Long enough for a glance at the
// position but short enough that the common "yes, resume" case feels like a
// gentle smart default rather than a wait.
const RESUME_AUTO_MS = 3500;

interface BrowserAudioTrack {
  id?: string;
  label?: string;
  language?: string;
  enabled: boolean;
}

interface BrowserAudioTrackList {
  length: number;
  [index: number]: BrowserAudioTrack;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
}

function audioTrackId(track: BrowserAudioTrack, index: number): string {
  return track.id || `${track.language || "audio"}-${index}`;
}

function snapshotAudioTracks(
  list: BrowserAudioTrackList | undefined,
): PlayerAudioTrack[] {
  if (!list || list.length === 0) return [];
  return Array.from({ length: list.length }, (_, i) => {
    const track = list[i];
    const language = track.language || undefined;
    return {
      id: audioTrackId(track, i),
      label:
        track.label ||
        (language ? `${language.toUpperCase()} audio` : `Audio track ${i + 1}`),
      language,
      enabled: Boolean(track.enabled),
    };
  });
}

export function DrivePlayer({
  src,
  subtitleTracks,
  title,
  initialSeek,
  silentResume,
  onMediaError,
  onLoadedMetadata,
  onTimeUpdate,
  onCanPlay,
  onFirstFrame,
  onVideoRef,
  onVideoElement,
  nextVideo,
  prevVideo,
  onNext,
  onPrev,
  mkvAudioTracks,
  selectedMkvAudioTrackNumber,
  onPickAudioTrackNumber,
  theatreMode,
  onToggleTheatre,
  ambientSourceUrl,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<number | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewPendingTimeRef = useRef<number | null>(null);
  const previewBusyRef = useRef(false);
  const activeScrubPointerIdRef = useRef<number | null>(null);

  // Stash callback props in a ref so the <video> event-binding effect only
  // runs once. Without this, every parent render that produces fresh
  // callback identities tears down and re-attaches all 12 media listeners.
  const callbacksRef = useRef({
    onMediaError,
    onLoadedMetadata,
    onTimeUpdate,
    onCanPlay,
    onFirstFrame,
  });
  useEffect(() => {
    callbacksRef.current = {
      onMediaError,
      onLoadedMetadata,
      onTimeUpdate,
      onCanPlay,
      onFirstFrame,
    };
  });

  useEffect(() => {
    return () => {
      if (previewTimerRef.current) {
        window.clearTimeout(previewTimerRef.current);
      }
    };
  }, []);

  // Guards: telemetry callbacks fire at most once per src.
  const canPlayFiredRef = useRef(false);
  const firstFrameFiredRef = useRef(false);
  useEffect(() => {
    canPlayFiredRef.current = false;
    firstFrameFiredRef.current = false;
  }, [src]);

  // Track whether we've already applied the parent-supplied initialSeek so
  // subsequent `loadedmetadata` events (e.g. user reload) don't re-seek.
  const initialSeekAppliedRef = useRef(false);
  useEffect(() => {
    initialSeekAppliedRef.current = false;
  }, [src, initialSeek]);

  // Mirror `initialSeek` into a ref so the loadedmetadata listener — which
  // is attached once via a stable-closure `useEffect([])` below — always
  // reads the latest prop value. Without this, a still-loading effect
  // updating `initialSeek` after first mount, or an autoplay-next jump to
  // the next episode (DrivePlayer stays mounted, only `src` changes),
  // would observe the stale closure-captured value and either skip the
  // resume pill entirely or fire it with the previous file's offset.
  const initialSeekRef = useRef(initialSeek);
  useEffect(() => {
    initialSeekRef.current = initialSeek;
  }, [initialSeek]);
  // Same closure trick for `silentResume`: the loadedmetadata handler attaches
  // once and needs the latest prop value when it fires (which can be hundreds
  // of ms after mount, well after props have settled).
  const silentResumeRef = useRef(silentResume);
  useEffect(() => {
    silentResumeRef.current = silentResume;
  }, [silentResume]);

  // Ambient backdrop glow — samples the dominant colour out of the supplied
  // poster URL and writes it as RGB CSS custom properties on the player
  // container. The actual bloom is painted by SCSS (box-shadow), which keeps
  // the JS side cheap: one fetch + draw + average per src change, no live
  // per-frame work. Falls back to brand defaults when sampling fails (tainted
  // canvas, network error, no URL).
  useEffect(() => {
    if (!ambientSourceUrl) return;
    let cancelled = false;
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 32;
        const ctx = canvas.getContext("2d", { willReadFrequently: false });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0, 32, 32);
        const data = ctx.getImageData(0, 0, 32, 32).data;
        let r = 0, g = 0, b = 0, count = 0;
        // Skip the near-black darks so a poster with a dark background
        // doesn't average toward grey — the bloom should pick up the
        // *accent* colour, not the void around it.
        for (let i = 0; i < data.length; i += 4) {
          const pr = data[i], pg = data[i + 1], pb = data[i + 2];
          const lum = pr + pg + pb;
          if (lum < 90) continue;
          r += pr;
          g += pg;
          b += pb;
          count++;
        }
        if (count < 16) return; // not enough non-dark pixels — keep default
        const el = containerRef.current;
        if (!el) return;
        el.style.setProperty("--ambient-r", String(Math.round(r / count)));
        el.style.setProperty("--ambient-g", String(Math.round(g / count)));
        el.style.setProperty("--ambient-b", String(Math.round(b / count)));
      } catch {
        // Tainted canvas (CORS) or other read failure — leave brand defaults.
      }
    };
    img.src = ambientSourceUrl;
    return () => {
      cancelled = true;
    };
  }, [ambientSourceUrl]);

  // Pre-roll "Now playing" card. Shows series + episode + runtime over the
  // first frame for a couple of seconds so every play has a cinematic moment
  // of presence. `prerollKey` bumps on each src so the same animation replays
  // when the user jumps to the next episode.
  const [prerollKey, setPrerollKey] = useState(0);
  const [prerollVisible, setPrerollVisible] = useState(false);
  useEffect(() => {
    setPrerollVisible(false);
    setPrerollKey((k) => k + 1);
  }, [src]);

  // Smart-resume pill. Replaces the old silent `v.currentTime = seek` with a
  // toast the user can accept or override. `status` distinguishes a live
  // pending pill from one already actioned, so the auto-resume timer doesn't
  // re-fire after the user clicks Restart.
  type ResumeStatus = "pending" | "resumed" | "restarted";
  const [resumePill, setResumePill] = useState<{
    positionSec: number;
    status: ResumeStatus;
  } | null>(null);
  const resumePillRef = useRef(resumePill);
  resumePillRef.current = resumePill;
  // Reset the pill whenever the src changes — a brand-new video gets its own
  // resume offer (or none, if PlayerPage didn't supply an initialSeek).
  useEffect(() => {
    setResumePill(null);
  }, [src]);

  const applyResume = useCallback(() => {
    const pill = resumePillRef.current;
    const v = videoRef.current;
    if (!pill || pill.status !== "pending" || !v) return;
    try {
      v.currentTime = pill.positionSec;
    } catch {
      // Range may have buffered late; ignore — the user can scrub manually.
    }
    setResumePill({ ...pill, status: "resumed" });
    // Hide the pill after the user sees the confirmation flicker.
    window.setTimeout(() => {
      if (resumePillRef.current?.status === "resumed") setResumePill(null);
    }, 600);
  }, []);

  const cancelResume = useCallback(() => {
    const pill = resumePillRef.current;
    if (!pill || pill.status !== "pending") return;
    setResumePill({ ...pill, status: "restarted" });
    window.setTimeout(() => {
      if (resumePillRef.current?.status === "restarted") setResumePill(null);
    }, 400);
  }, []);

  // Auto-resume after RESUME_AUTO_MS. The timer attaches whenever a fresh
  // pending pill mounts; clearing the state (Restart click) cancels it via
  // the cleanup return.
  useEffect(() => {
    if (!resumePill || resumePill.status !== "pending") return;
    const t = window.setTimeout(applyResume, RESUME_AUTO_MS);
    return () => window.clearTimeout(t);
  }, [resumePill, applyResume]);

  // Video state mirror -------------------------------------------------------
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [audioTracks, setAudioTracks] = useState<PlayerAudioTrack[]>([]);
  const [activeAudioId, setActiveAudioId] = useState<string | null>(null);
  const [speed, setSpeed] = useState(1);
  const [buffering, setBuffering] = useState(true);
  const [looping, setLooping] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // Next-up card: visible during the last few seconds of the episode.
  // Dismissal latches per-episode (resets when nextVideo identity changes)
  // so a user who clicks "Stay" isn't pestered again on the same file.
  const [nextUpDismissed, setNextUpDismissed] = useState(false);
  useEffect(() => {
    setNextUpDismissed(false);
  }, [nextVideo?.fileId]);
  // The video-listener effect attaches once and reads these via ref so we
  // don't reattach every render. The bag is updated below on each commit.
  const autoplayNextRef = useRef(false);
  const nextRef = useRef<Props["nextVideo"]>(null);
  const dismissedRef = useRef(false);
  const onNextRef = useRef<Props["onNext"]>(undefined);

  // Subtitle state -----------------------------------------------------------
  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [subDelay, setSubDelay] = useState(0);
  // JASSUB readiness. Until `jassubReady` flips true, we keep the plain-text
  // CSS overlay live so the user always sees *some* subtitles — even if
  // libass is still booting its worker or failed to load (CSP/WASM/etc).
  // `jassubFailed` latches true on init or setTrack error so we permanently
  // fall back to CSS for the current track instead of staring at an empty
  // canvas. Both reset whenever the active track changes.
  const [jassubReady, setJassubReady] = useState(false);
  const [jassubFailed, setJassubFailed] = useState(false);
  useEffect(() => {
    setJassubReady(false);
    setJassubFailed(false);
  }, [activeSubId]);
  const handleJassubReady = useCallback(() => setJassubReady(true), []);
  const handleJassubError = useCallback((err: unknown) => {
    // eslint-disable-next-line no-console
    console.warn("[player] JASSUB unavailable; using CSS overlay fallback", err);
    setJassubFailed(true);
  }, []);

  // Persisted settings (subtitle scale/font, skip seconds) ------------------
  const settings = useSettingsStore((s) => s.settings);
  const setScale = useSettingsStore((s) => s.setScale);
  const subFontStack = useMemo(
    () => fontStackFor(settings.subtitleFont),
    [settings.subtitleFont],
  );

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const nextVolume = Math.max(0, Math.min(1, settings.defaultVolume));
    v.volume = nextVolume;
    if (nextVolume > 0) v.muted = false;
    setVolume(nextVolume);
    setMuted(v.muted);
  }, [settings.defaultVolume]);

  useEffect(() => {
    const v = videoRef.current as
      | (HTMLVideoElement & { audioTracks?: BrowserAudioTrackList })
      | null;
    if (!v) return;
    const list = v.audioTracks;

    // MKV-derived list wins when present — it has the muxer-authored labels
    // ("Japanese 5.1") that Chrome's `audioTracks` doesn't surface, and it's
    // the only source of multi-track info in MSE mode (where the fMP4 only
    // carries the selected track).
    //
    // A track is rendered DISABLED in the picker when we have no path to
    // switch INTO it. Two reasons knock a track out:
    //
    //   1. The codec isn't in the MSE remuxer's whitelist (e.g. DTS,
    //      TrueHD) — we can't build a fresh fMP4 init segment for it.
    //   2. PlayerPage found no browser path for it: neither MSE packaging
    //      nor the external WebCodecs audio lane can play that track. AC-3 is
    //      currently allowed through as an experimental test path.
    //
    // The currently-playing track is always enabled — even if its codec
    // hits one of those gates, clicking your own active dub is a no-op
    // anyway, and forcing it disabled would look like a bug.
    // The muxer-default is also always enabled because native playback
    // is already producing audio for it without any of our pipeline.
    const defaultTrackNumber = mkvAudioTracks?.[0]?.number;
    function refreshAudioTracks() {
      if (mkvAudioTracks && mkvAudioTracks.length > 0) {
        const tracks: PlayerAudioTrack[] = mkvAudioTracks.map((t) => {
          const isActive = t.number === selectedMkvAudioTrackNumber;
          const isMuxerDefault = t.number === defaultTrackNumber;
          const normCodec = t.codecId.toUpperCase().replace(/\s/g, "");
          const isExperimentalAc3 =
            t.remuxable &&
            normCodec === "A_AC3" &&
            t.browserSupported === false;
          const reason = !t.remuxable
            ? `${t.codecId} isn't in the MSE remuxer's whitelist. ` +
              `Nyrima can't switch into this dub on its own.`
            : t.browserSupported === false && !isExperimentalAc3
              ? `Your browser refuses ${t.codecId} for this file's ` +
                `available playback paths.`
              : undefined;
          const switchable = !reason || isMuxerDefault || isExperimentalAc3;
          return {
            id: `mkv-${t.number}`,
            label: t.label,
            language: t.language,
            enabled: isActive,
            disabled: !isActive && !switchable,
            disabledReason: switchable ? undefined : reason,
            badge: isExperimentalAc3 ? "TEST" : undefined,
          };
        });
        setAudioTracks(tracks);
        const active = tracks.find((t) => t.enabled);
        setActiveAudioId(active?.id ?? tracks[0]?.id ?? null);
        return;
      }
      const next = snapshotAudioTracks(list);
      setAudioTracks(next);
      setActiveAudioId(next.find((track) => track.enabled)?.id ?? null);
    }

    refreshAudioTracks();
    v.addEventListener("loadedmetadata", refreshAudioTracks);
    list?.addEventListener?.("change", refreshAudioTracks);
    list?.addEventListener?.("addtrack", refreshAudioTracks);
    list?.addEventListener?.("removetrack", refreshAudioTracks);
    return () => {
      v.removeEventListener("loadedmetadata", refreshAudioTracks);
      list?.removeEventListener?.("change", refreshAudioTracks);
      list?.removeEventListener?.("addtrack", refreshAudioTracks);
      list?.removeEventListener?.("removetrack", refreshAudioTracks);
    };
  }, [src, mkvAudioTracks, selectedMkvAudioTrackNumber]);

  // Keep the `ended`-handler refs in sync with the latest prop / setting values.
  useEffect(() => {
    autoplayNextRef.current = settings.autoplayNext;
    nextRef.current = nextVideo ?? null;
    dismissedRef.current = nextUpDismissed;
    onNextRef.current = onNext;
  });

  // Auto-select the first renderable text subtitle when tracks load, and
  // recover when changing episodes leaves activeSubId pointing at a stale id.
  useEffect(() => {
    const activeTrackExists =
      activeSubId !== null &&
      subtitleTracks.some((t) => t.id === activeSubId && !t.imageBased);
    if (activeTrackExists) return;

    const firstText = subtitleTracks.find((t) => !t.imageBased);
    if (firstText) {
      if (activeSubId !== firstText.id) setActiveSubId(firstText.id);
    } else if (activeSubId !== null) {
      setActiveSubId(null);
    }
  }, [subtitleTracks, activeSubId]);

  // UI state ----------------------------------------------------------------
  const [hudOn, setHudOn] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const [previewStatus, setPreviewStatus] = useState<
    "idle" | "loading" | "ready" | "unavailable"
  >("idle");
  const [scrubbing, setScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState<number | null>(null);
  const scrubbingRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Subscribe to <video> events --------------------------------------------
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;

    const handlers = {
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      timeupdate: () => {
        // ~4 Hz already; guard against no-op state updates that would
        // re-render the entire SubtitleOverlay tree.
        setCurrentTime((prev) =>
          Math.abs(v.currentTime - prev) < 0.05 ? prev : v.currentTime,
        );
        callbacksRef.current.onTimeUpdate?.(v.currentTime, v.duration || 0);
      },
      durationchange: () => setDuration(isFinite(v.duration) ? v.duration : 0),
      ended: () => {
        // Autoplay-next gate: respects the user setting and the in-episode
        // dismissal. `onNext` is intentionally read off the ref-stable callback
        // bag so a fresh `nextVideo` prop doesn't re-attach this handler.
        if (autoplayNextRef.current && nextRef.current && !dismissedRef.current) {
          onNextRef.current?.();
        }
      },
      loadedmetadata: () => {
        const dur = isFinite(v.duration) ? v.duration : 0;
        setDuration(dur);
        setBuffering(false);
        // Resume offer. Surfaces a pill the user can accept (jump to the
        // saved position) or reject (start from 0). The pill auto-applies
        // after a few seconds via the effect below so the common "yes, resume"
        // case stays one click free; an explicit Restart click skips the
        // jump entirely. `initialSeekAppliedRef` keeps the offer single-shot
        // across re-loads of the same src.
        //
        // Read `initialSeek` off the ref (not the closure) so the value is
        // never stale — this handler is attached once via empty-deps
        // useEffect and the closure capture would otherwise lock in
        // whatever `initialSeek` was at first mount.
        const seek = initialSeekRef.current ?? 0;
        if (
          !initialSeekAppliedRef.current &&
          seek > 0 &&
          dur > 0 &&
          seek < dur - 2
        ) {
          initialSeekAppliedRef.current = true;
          if (silentResumeRef.current) {
            // Dub-switch reload (or similar): apply the seek immediately
            // instead of asking the user to confirm. They've already been
            // watching this clip; no need to interrupt with a pill.
            try {
              v.currentTime = seek;
            } catch {
              // Buffer might not cover this offset yet — the browser will
              // park `currentTime` at the closest seekable point and stream
              // the rest in. Same recovery as the regular resume path.
            }
          } else {
            setResumePill({ positionSec: seek, status: "pending" });
          }
        }
        callbacksRef.current.onLoadedMetadata?.(v.duration);
      },
      progress: () => {
        if (v.buffered.length > 0) {
          setBufferedEnd(v.buffered.end(v.buffered.length - 1));
        }
      },
      volumechange: () => {
        setVolume(v.volume);
        setMuted(v.muted);
      },
      ratechange: () => setSpeed(v.playbackRate),
      waiting: () => setBuffering(true),
      canplay: () => {
        setBuffering(false);
        if (!canPlayFiredRef.current) {
          canPlayFiredRef.current = true;
          markPlayback("video:canplay");
          callbacksRef.current.onCanPlay?.();
          // Fire the pre-roll "Now playing" card on first canplay only. The
          // hide is scheduled by the card itself via CSS animation; this just
          // mounts it. Bumping `prerollKey` in the src-change effect ensures
          // a fresh fade-in on the next episode.
          setPrerollVisible(true);
        }
      },
      playing: () => setBuffering(false),
      error: () => {
        setBuffering(false);
        callbacksRef.current.onMediaError?.(v.error);
      },
    } as const;

    for (const [evt, fn] of Object.entries(handlers)) {
      v.addEventListener(evt, fn as EventListener);
    }
    return () => {
      for (const [evt, fn] of Object.entries(handlers)) {
        v.removeEventListener(evt, fn as EventListener);
      }
    };
    // Deliberately empty: the listeners use callbacksRef, so they don't need
    // to be re-bound when callback prop identities change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Expose <video> ref to parent for MSE attachment.
  useEffect(() => {
    if (onVideoRef) onVideoRef(videoRef.current);
  }, [onVideoRef]);

  // Pure observer hook for things like the screenshot button — fires with
  // the live element on mount, then with `null` on unmount so the parent
  // can clear its ref. Does not affect how DrivePlayer manages `src`.
  useEffect(() => {
    if (!onVideoElement) return;
    onVideoElement(videoRef.current);
    return () => onVideoElement(null);
  }, [onVideoElement]);

  // Telemetry: mark the first painted frame for the current src.
  // requestVideoFrameCallback is Chromium-only and the only reliable way to
  // tell "the user actually saw a pixel" vs "the browser thinks it can play".
  useEffect(() => {
    const v = videoRef.current as HTMLVideoElement &
      { requestVideoFrameCallback?: (cb: () => void) => number };
    if (!v || typeof v.requestVideoFrameCallback !== "function") return;
    let cancelled = false;
    v.requestVideoFrameCallback(() => {
      if (cancelled || firstFrameFiredRef.current) return;
      firstFrameFiredRef.current = true;
      markPlayback("video:first-frame");
      callbacksRef.current.onFirstFrame?.();
    });
    return () => {
      cancelled = true;
    };
  }, [src]);

  useEffect(() => {
    setPreviewStatus("idle");
    previewPendingTimeRef.current = null;
    previewBusyRef.current = false;
    const canvas = previewCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, [src]);

  useEffect(() => {
    const pv = previewVideoRef.current;
    if (!pv) return;

    const seekPending = () => {
      const next = previewPendingTimeRef.current;
      if (next == null || previewBusyRef.current || !Number.isFinite(next)) {
        return;
      }
      if (pv.readyState < 1) {
        pv.load();
        return;
      }
      previewBusyRef.current = true;
      setPreviewStatus("loading");
      try {
        pv.currentTime = Math.max(0, Math.min(next, pv.duration || next));
      } catch {
        previewBusyRef.current = false;
        setPreviewStatus("unavailable");
      }
    };

    const drawPreview = () => {
      const canvas = previewCanvasRef.current;
      if (!canvas) {
        previewBusyRef.current = false;
        return;
      }
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        previewBusyRef.current = false;
        return;
      }
      try {
        ctx.drawImage(pv, 0, 0, canvas.width, canvas.height);
        setPreviewStatus("ready");
      } catch {
        setPreviewStatus("unavailable");
      } finally {
        previewBusyRef.current = false;
        const pending = previewPendingTimeRef.current;
        if (
          pending != null &&
          Number.isFinite(pending) &&
          Math.abs(pending - pv.currentTime) > 0.35
        ) {
          window.setTimeout(seekPending, 0);
        }
      }
    };

    const handlePreviewError = () => {
      previewBusyRef.current = false;
      setPreviewStatus("unavailable");
    };

    pv.addEventListener("loadedmetadata", seekPending);
    pv.addEventListener("seeked", drawPreview);
    pv.addEventListener("error", handlePreviewError);
    return () => {
      pv.removeEventListener("loadedmetadata", seekPending);
      pv.removeEventListener("seeked", drawPreview);
      pv.removeEventListener("error", handlePreviewError);
    };
  }, [src]);

  // Sync loop attribute on <video>
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.loop = looping;
  }, [looping]);

  // HUD auto-hide ------------------------------------------------------------
  const kickIdleTimer = useCallback(() => {
    setHudOn(true);
    if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    if (!playing) return; // never auto-hide while paused
    idleTimerRef.current = window.setTimeout(() => {
      setHudOn(false);
      setShowSettings(false);
    }, 2600);
  }, [playing]);

  useEffect(() => {
    kickIdleTimer();
    return () => {
      if (idleTimerRef.current) window.clearTimeout(idleTimerRef.current);
    };
  }, [kickIdleTimer]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    const onMove = () => kickIdleTimer();
    const onLeave = () => {
      if (playing) setHudOn(false);
    };
    function onWheel(e: WheelEvent) {
      const v = videoRef.current;
      if (!v) return;
      // Don't hijack the wheel when the user is scrolling a menu or the
      // volume rail itself — those have their own scroll/click semantics.
      const t = e.target as HTMLElement | null;
      if (t?.closest(".dc-vlc__menu")) return;
      e.preventDefault();
      const step = e.deltaY < 0 ? +0.05 : -0.05;
      v.volume = Math.max(0, Math.min(1, v.volume + step));
      if (v.volume > 0) v.muted = false;
      kickIdleTimer();
    }
    c.addEventListener("mousemove", onMove);
    c.addEventListener("mouseleave", onLeave);
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      c.removeEventListener("mousemove", onMove);
      c.removeEventListener("mouseleave", onLeave);
      c.removeEventListener("wheel", onWheel);
    };
  }, [kickIdleTimer, playing]);

  // Fullscreen sync ----------------------------------------------------------
  useEffect(() => {
    function onFsChange() {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    }
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Keyboard shortcuts (scoped to player) ------------------------------------
  useEffect(() => {
    const c = containerRef.current;
    if (!c) return;
    function onKey(e: KeyboardEvent) {
      const v = videoRef.current;
      if (!v) return;
      const k = e.key.toLowerCase();
      // Ignore keys typed into form inputs nested in the HUD.
      if (e.target instanceof HTMLInputElement) return;
      // Digit jumps (0–9 → 0–90 % of duration). Use e.code so non-US
      // layouts still seek. Skip if any modifier is held so we don't
      // stomp Ctrl/Alt browser shortcuts.
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        /^Digit[0-9]$/.test(e.code)
      ) {
        const digit = Number(e.code.slice(5));
        if (v.duration > 0 && Number.isFinite(v.duration)) {
          e.preventDefault();
          v.currentTime = (digit / 10) * v.duration;
          kickIdleTimer();
        }
        return;
      }

      switch (k) {
        case " ":
        case "k":
          e.preventDefault();
          togglePlay();
          break;
        case "arrowleft":
          e.preventDefault();
          v.currentTime = Math.max(0, v.currentTime - settings.skipSeconds);
          kickIdleTimer();
          break;
        case "arrowright":
          e.preventDefault();
          v.currentTime = Math.min(
            v.duration || 0,
            v.currentTime + settings.skipSeconds,
          );
          kickIdleTimer();
          break;
        case "j":
          v.currentTime = Math.max(0, v.currentTime - 30);
          kickIdleTimer();
          break;
        case "l":
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 30);
          kickIdleTimer();
          break;
        case "home":
          e.preventDefault();
          v.currentTime = 0;
          kickIdleTimer();
          break;
        case "end":
          e.preventDefault();
          if (v.duration > 0 && Number.isFinite(v.duration)) {
            v.currentTime = Math.max(0, v.duration - 5);
            kickIdleTimer();
          }
          break;
        case "escape":
          if (document.fullscreenElement === containerRef.current) {
            e.preventDefault();
            void document.exitFullscreen().catch(() => undefined);
            kickIdleTimer();
          }
          break;
        case "arrowup":
          e.preventDefault();
          v.volume = Math.min(1, v.volume + 0.05);
          if (v.volume > 0) v.muted = false;
          kickIdleTimer();
          break;
        case "arrowdown":
          e.preventDefault();
          v.volume = Math.max(0, v.volume - 0.05);
          kickIdleTimer();
          break;
        case "+":
        case "=":
          e.preventDefault();
          void setScale(
            Math.min(SCALE_MAX, settings.subtitleScale + SCALE_STEP),
          );
          kickIdleTimer();
          break;
        case "-":
        case "_":
          e.preventDefault();
          void setScale(
            Math.max(SCALE_MIN, settings.subtitleScale - SCALE_STEP),
          );
          kickIdleTimer();
          break;
        case "<":
          e.preventDefault();
          changeSpeedRelative(v, -0.25);
          kickIdleTimer();
          break;
        case ">":
          e.preventDefault();
          changeSpeedRelative(v, +0.25);
          kickIdleTimer();
          break;
        case "m":
          v.muted = !v.muted;
          break;
        case "f":
          toggleFullscreen();
          break;
        case "c":
          cycleSubTrack();
          break;
        case ",":
          setSubDelay((d) => d - 0.5);
          break;
        case ".":
          setSubDelay((d) => d + 0.5);
          break;
        case "n":
          onNext?.();
          break;
        case "p":
          onPrev?.();
          break;
        case "?":
        case "/":
          // Shift+/ on US layouts is "?". Accept both so AZERTY/non-US
          // keyboards (where ? often needs no shift) still hit this.
          e.preventDefault();
          setShortcutsOpen((open) => !open);
          kickIdleTimer();
          break;
        default:
          return;
      }
    }
    c.tabIndex = 0;
    c.addEventListener("keydown", onKey);
    return () => c.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    subtitleTracks.length,
    playing,
    onNext,
    onPrev,
    settings.skipSeconds,
    settings.subtitleScale,
  ]);

  // Skip-back / skip-forward by the user-configured `skipSeconds`. Bound to
  // the HUD buttons; keyboard already has ←/→ for the same jump.
  function skipBy(delta: number) {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(
      0,
      Math.min(v.duration || 0, v.currentTime + delta),
    );
    kickIdleTimer();
  }

  // Actions ------------------------------------------------------------------
  function togglePlay() {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused || v.ended) {
      void v.play().catch(() => undefined);
    } else {
      v.pause();
    }
  }

  function toggleFullscreen() {
    const c = containerRef.current;
    if (!c) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    } else {
      void c.requestFullscreen().catch(() => undefined);
    }
  }

  function toggleMute() {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
  }

  function setVideoVolumePct(pct: number) {
    const v = videoRef.current;
    if (!v) return;
    const nextPct = Math.max(0, Math.min(100, pct));
    v.volume = nextPct / 100;
    if (nextPct > 0) v.muted = false;
  }

  function changeSpeed(s: number) {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = s;
  }

  /**
   * Bump playbackRate by a delta, snapping to the SPEEDS preset that the
   * picker UI knows about (clamped to the first/last preset). Called by the
   * `<` / `>` keyboard shortcuts.
   */
  function changeSpeedRelative(v: HTMLVideoElement, delta: number) {
    const current = v.playbackRate;
    const target = Math.max(
      SPEEDS[0],
      Math.min(SPEEDS[SPEEDS.length - 1], current + delta),
    );
    let nearest = SPEEDS[0];
    let bestGap = Infinity;
    for (const s of SPEEDS) {
      const g = Math.abs(s - target);
      if (g < bestGap) {
        bestGap = g;
        nearest = s;
      }
    }
    v.playbackRate = nearest;
  }

  function pickSub(id: string | null) {
    setActiveSubId(id);
  }

  function pickAudioTrack(id: string) {
    // MKV path: the SettingsPopover ids are `mkv-<TrackNumber>`. We do two
    // things — flip the browser's audioTracks[i] (for native MKVs Chrome
    // already plays all dubs; flipping `.enabled` switches without a reload),
    // AND fire the parent callback so PlayerPage can re-mount the MSE
    // controller if we're in MSE mode (where the browser only ever sees the
    // one fMP4-baked track).
    const mkvMatch = mkvAudioTracks?.find((t) => `mkv-${t.number}` === id);
    if (mkvMatch && onPickAudioTrackNumber) {
      const v = videoRef.current as
        | (HTMLVideoElement & { audioTracks?: BrowserAudioTrackList })
        | null;
      const list = v?.audioTracks;
      if (list && list.length > 0) {
        // Best-effort native-side switch: flip by position. The MKV list and
        // the browser list are usually in the same order (Matroska TrackEntry
        // order = audioTracks index order in Chrome's parser), so this lets
        // the dub change happen without re-muxing.
        const idx = mkvAudioTracks!.indexOf(mkvMatch);
        for (let i = 0; i < list.length; i++) {
          list[i].enabled = i === idx;
        }
      }
      setActiveAudioId(id);
      onPickAudioTrackNumber(mkvMatch.number);
      return;
    }

    // Legacy fallback: SettingsPopover ids are the browser-derived ids
    // (used for non-MKV files, e.g. an `.mp4` with two embedded dubs).
    const v = videoRef.current as
      | (HTMLVideoElement & { audioTracks?: BrowserAudioTrackList })
      | null;
    const list = v?.audioTracks;
    if (!list) return;
    for (let i = 0; i < list.length; i++) {
      const track = list[i];
      track.enabled = audioTrackId(track, i) === id;
    }
    const next = snapshotAudioTracks(list);
    setAudioTracks(next);
    setActiveAudioId(next.find((track) => track.enabled)?.id ?? id);
  }

  function cycleSubTrack() {
    if (subtitleTracks.length === 0) return;
    const idx = subtitleTracks.findIndex((t) => t.id === activeSubId);
    if (idx === -1) {
      setActiveSubId(subtitleTracks[0].id);
    } else if (idx < subtitleTracks.length - 1) {
      setActiveSubId(subtitleTracks[idx + 1].id);
    } else {
      setActiveSubId(null);
    }
  }

  function toggleLoop() {
    setLooping((v) => !v);
  }

  async function togglePiP() {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await v.requestPictureInPicture();
      }
    } catch {
      // ignore
    }
  }

  function adjustSubDelay(delta: number) {
    setSubDelay((d) => Math.round((d + delta) * 10) / 10);
  }

  // Timeline scrubbing -------------------------------------------------------
  function getSeekableDuration(): number {
    const mediaDuration = videoRef.current?.duration;
    if (duration > 0 && Number.isFinite(duration)) return duration;
    if (mediaDuration && mediaDuration > 0 && Number.isFinite(mediaDuration)) {
      return mediaDuration;
    }
    return 0;
  }

  function pctFromClientX(clientX: number): number | null {
    const t = timelineRef.current;
    if (!t) return null;
    const rect = t.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }

  function commitTimelineTime(time: number) {
    const seekDuration = getSeekableDuration();
    if (!seekDuration) return;
    const nextTime = Math.max(0, Math.min(time, seekDuration));
    const v = videoRef.current;
    setCurrentTime(nextTime);
    if (v) v.currentTime = nextTime;
    kickIdleTimer();
  }

  function updateTimelineFromClientX(
    clientX: number,
    mode: "hover" | "scrub" | "commit",
  ): number | null {
    const seekDuration = getSeekableDuration();
    if (!seekDuration) return null;
    const pct = pctFromClientX(clientX);
    if (pct === null) return null;
    const nextTime = pct * seekDuration;
    setHoverTime(nextTime);
    setHoverX(pct);
    queueTimelinePreview(nextTime);
    if (mode !== "hover") {
      setScrubTime(nextTime);
    }
    if (mode === "commit") {
      commitTimelineTime(nextTime);
    }
    return nextTime;
  }

  function onTimelinePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!getSeekableDuration()) return;
    if (scrubbingRef.current) {
      e.preventDefault();
      updateTimelineFromClientX(e.clientX, "scrub");
      return;
    }
    updateTimelineFromClientX(e.clientX, "hover");
  }

  function onTimelinePointerLeave() {
    if (scrubbingRef.current) return;
    setHoverTime(null);
    setPreviewStatus("idle");
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
      previewTimerRef.current = null;
    }
  }

  function onTimelinePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!getSeekableDuration()) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.focus();
    activeScrubPointerIdRef.current = e.pointerId;
    scrubbingRef.current = true;
    setScrubbing(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Pointer capture can fail if the browser has already cancelled the
      // pointer; the window listeners below keep the drag usable.
    }
    updateTimelineFromClientX(e.clientX, "scrub");
  }

  function finishTimelineScrub(
    target: HTMLDivElement | null,
    pointerId: number | null,
    clientX?: number,
  ) {
    if (!scrubbingRef.current) return;
    if (
      activeScrubPointerIdRef.current !== null &&
      pointerId !== null &&
      pointerId !== activeScrubPointerIdRef.current
    ) {
      return;
    }
    if (typeof clientX === "number") {
      updateTimelineFromClientX(clientX, "commit");
    }
    if (
      target &&
      pointerId !== null &&
      target.hasPointerCapture(pointerId)
    ) {
      target.releasePointerCapture(pointerId);
    }
    activeScrubPointerIdRef.current = null;
    scrubbingRef.current = false;
    setScrubbing(false);
    setScrubTime(null);
  }

  function finishTimelinePointer(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    finishTimelineScrub(e.currentTarget, e.pointerId, e.clientX);
  }

  function onTimelineKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const seekDuration = getSeekableDuration();
    if (!seekDuration) return;
    const base = scrubTime ?? videoRef.current?.currentTime ?? currentTime;
    let nextTime: number | null = null;
    switch (e.key) {
      case "ArrowLeft":
        nextTime = base - settings.skipSeconds;
        break;
      case "ArrowRight":
        nextTime = base + settings.skipSeconds;
        break;
      case "PageDown":
        nextTime = base - 30;
        break;
      case "PageUp":
        nextTime = base + 30;
        break;
      case "Home":
        nextTime = 0;
        break;
      case "End":
        nextTime = seekDuration;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    commitTimelineTime(nextTime);
  }

  useEffect(() => {
    if (!scrubbing) return;
    function onWindowPointerMove(e: PointerEvent) {
      if (
        activeScrubPointerIdRef.current !== null &&
        e.pointerId !== activeScrubPointerIdRef.current
      ) {
        return;
      }
      e.preventDefault();
      updateTimelineFromClientX(e.clientX, "scrub");
    }
    function onWindowPointerEnd(e: PointerEvent) {
      if (
        activeScrubPointerIdRef.current !== null &&
        e.pointerId !== activeScrubPointerIdRef.current
      ) {
        return;
      }
      e.preventDefault();
      finishTimelineScrub(timelineRef.current, e.pointerId, e.clientX);
    }
    window.addEventListener("pointermove", onWindowPointerMove, {
      passive: false,
    });
    window.addEventListener("pointerup", onWindowPointerEnd);
    window.addEventListener("pointercancel", onWindowPointerEnd);
    return () => {
      window.removeEventListener("pointermove", onWindowPointerMove);
      window.removeEventListener("pointerup", onWindowPointerEnd);
      window.removeEventListener("pointercancel", onWindowPointerEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrubbing]);

  useEffect(() => {
    activeScrubPointerIdRef.current = null;
    scrubbingRef.current = false;
    setScrubbing(false);
    setScrubTime(null);
  }, [src]);

  function queueTimelinePreview(time: number) {
    if (!src || onVideoRef || !Number.isFinite(time)) {
      setPreviewStatus("unavailable");
      return;
    }
    previewPendingTimeRef.current = time;
    if (previewTimerRef.current) {
      window.clearTimeout(previewTimerRef.current);
    }
    previewTimerRef.current = window.setTimeout(() => {
      previewTimerRef.current = null;
      const pv = previewVideoRef.current;
      const pending = previewPendingTimeRef.current;
      if (!pv || pending == null) {
        setPreviewStatus("unavailable");
        return;
      }
      if (previewBusyRef.current) return;
      if (pv.readyState < 1) {
        setPreviewStatus("loading");
        pv.load();
        return;
      }
      previewBusyRef.current = true;
      setPreviewStatus("loading");
      try {
        pv.currentTime = Math.max(0, Math.min(pending, pv.duration || pending));
      } catch {
        previewBusyRef.current = false;
        setPreviewStatus("unavailable");
      }
    }, 120);
  }

  const displayTime = scrubTime ?? currentTime;

  const playedPct = useMemo(() => {
    if (!duration) return 0;
    return (displayTime / duration) * 100;
  }, [displayTime, duration]);

  const bufferedPct = useMemo(() => {
    if (!duration) return 0;
    return (bufferedEnd / duration) * 100;
  }, [bufferedEnd, duration]);

  const volPct = Math.round(volume * 100);

  const activeTrack = useMemo(
    () => subtitleTracks.find((t) => t.id === activeSubId) ?? null,
    [subtitleTracks, activeSubId],
  );

  // Tracks with a reconstituted ASS source render through libass (JASSUB) so
  // typesetting (positions, karaoke, fades, fonts, colors) survives. Plain
  // SRT/VTT and untyped text tracks fall back to the CSS overlay. Embedded
  // MKV ASS only enters this path after extraction finalizes, so libass sees
  // a stable script instead of blinking through repeated track reloads.
  const jassubIntended =
    !!activeTrack?.assSource && activeTrack.assRenderer === "jassub";
  // libass is the *winning* renderer only after the worker reports ready AND
  // hasn't surfaced an error. While booting (or after failure), the CSS
  // overlay keeps the cues visible so the user is never stuck staring at a
  // blank video while JASSUB is loading or has silently failed.
  const useJassub = jassubIntended && jassubReady && !jassubFailed;

  // Stable empty-cues reference so SubtitleOverlay's memo doesn't bust when
  // no track matches activeSubId.
  const activeCues = useMemo(
    () =>
      useJassub
        ? (EMPTY_CUES as SubCue[])
        : (activeTrack?.cues as SubCue[] | undefined) ??
          (EMPTY_CUES as SubCue[]),
    [activeTrack, useJassub],
  );
  const subtitleStatus = useMemo(
    () =>
      describeSubtitleStatus({
        activeSubId,
        activeTrack,
        trackCount: subtitleTracks.length,
        useJassub,
        jassubIntended,
        jassubFailed,
      }),
    [
      activeSubId,
      activeTrack,
      subtitleTracks.length,
      useJassub,
      jassubIntended,
      jassubFailed,
    ],
  );


  return (
    <div
      ref={containerRef}
      className={cn("dc-vlc", {
        "is-hud-on": hudOn || !playing,
        "is-playing": playing,
        "is-fullscreen": isFullscreen,
      })}
      onMouseMove={kickIdleTimer}
      onDoubleClick={(e) => {
        // Don't fullscreen when clicking inside the HUD (timeline, buttons).
        if ((e.target as HTMLElement).closest(".dc-vlc__hud, .dc-vlc__top"))
          return;
        toggleFullscreen();
      }}
    >
      <video
        ref={videoRef}
        src={onVideoRef ? undefined : src || undefined}
        autoPlay
        playsInline
        preload="metadata"
        onClick={(e) => {
          if (
            (e.target as HTMLElement).closest(
              ".dc-vlc__hud, .dc-vlc__top, .dc-vlc__center",
            )
          ) {
            return;
          }
          togglePlay();
        }}
      />
      {src && !onVideoRef && (
        <video
          ref={previewVideoRef}
          className="dc-vlc__preview-source"
          src={src}
          muted
          playsInline
          preload="metadata"
          aria-hidden
        />
      )}

      <SubtitleOverlay
        videoRef={videoRef}
        cues={activeCues}
        delay={subDelay}
        scale={settings.subtitleScale}
        fontFamily={subFontStack}
        fontWeight={settings.subtitleWeight}
        color={settings.subtitleColor}
        outlineColor={settings.subtitleOutlineColor}
        outlineWidth={settings.subtitleOutlineWidth}
        shadowStrength={settings.subtitleShadow}
        letterSpacing={settings.subtitleLetterSpacing}
        bottomOffset={settings.subtitlePosition}
        isFullscreen={isFullscreen}
      />

      {/* JASSUB stays mounted while the track *intends* to use libass — even
          when it hasn't signalled ready yet. The mount triggers worker
          bootstrap; once `onReady` fires, useJassub flips true and the CSS
          overlay blanks. If `onError` fires, useJassub stays false and the
          CSS overlay keeps rendering as a graceful fallback. */}
      {jassubIntended && !jassubFailed && activeTrack?.assSource && (
        <JassubOverlay
          videoRef={videoRef}
          subContent={activeTrack.assSource}
          timeOffset={subDelay}
          onReady={handleJassubReady}
          onError={handleJassubError}
        />
      )}

      {/* Blu-ray PGS bitmaps render through a dedicated canvas overlay. The
          CSS SubtitleOverlay above still mounts but stays empty (cues is the
          empty array because PGS tracks don't populate `cues`), so we can
          layer them without coordination. */}
      {activeTrack?.pgsCompositions && activeTrack.pgsCompositions.length > 0 && (
        <PgsOverlay
          videoRef={videoRef}
          compositions={activeTrack.pgsCompositions}
          delay={subDelay}
        />
      )}

      {/* Four corner brackets */}
      <div className="dc-vlc__corners" aria-hidden>
        <span className="tl" />
        <span className="tr" />
        <span className="bl" />
        <span className="br" />
      </div>

      {/* Top kana eyebrow */}
      <div className="dc-vlc__top">
        <div className="dc-vlc__top-left">
          <span className="dc-vlc__top-kana">
            {playing ? "再生中 · NOW PLAYING" : "一時停止 · PAUSED"}
          </span>
          {title && <span className="dc-vlc__top-title">{title}</span>}
        </div>
        <span
          className={cn("dc-vlc__sub-status", `is-${subtitleStatus.tone}`)}
          title={subtitleStatus.title}
        >
          <span>{subtitleStatus.label}</span>
          <em>{subtitleStatus.detail}</em>
        </span>
      </div>

      {/* Center playback cluster — skip-back / play-pause / skip-forward, all
          gold-themed to match the player. Always mounted so we get a real
          fade in/out animation; visibility is driven by `is-on` (paused or
          HUD visible) instead of conditional unmount, otherwise the buttons
          would pop in and out of the DOM without a transition. The cluster
          stops short of the subtitle bottom zone so it never overlaps cues. */}
      <div
        className={cn("dc-vlc__center", {
          "is-on": (hudOn || !playing) && !buffering,
        })}
        role="group"
        aria-label="Playback"
        aria-hidden={!((hudOn || !playing) && !buffering)}
      >
        <button
          type="button"
          className="dc-vlc__center-skip"
          onClick={() => skipBy(-settings.skipSeconds)}
          title={`Skip back ${settings.skipSeconds}s (←)`}
          aria-label={`Skip back ${settings.skipSeconds} seconds`}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" />
          </svg>
          <span className="dc-vlc__skip-num">{settings.skipSeconds}</span>
        </button>

        <button
          type="button"
          className="dc-vlc__center-knob"
          onClick={togglePlay}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          )}
        </button>

        <button
          type="button"
          className="dc-vlc__center-skip"
          onClick={() => skipBy(settings.skipSeconds)}
          title={`Skip forward ${settings.skipSeconds}s (→)`}
          aria-label={`Skip forward ${settings.skipSeconds} seconds`}
        >
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M12 5V1l5 5-5 5V7c-3.31 0-6 2.69-6 6s2.69 6 6 6 6-2.69 6-6h2c0 4.42-3.58 8-8 8s-8-3.58-8-8 3.58-8 8-8z" />
          </svg>
          <span className="dc-vlc__skip-num">{settings.skipSeconds}</span>
        </button>
      </div>

      {/* Buffering spinner */}
      {buffering && (
        <div className="dc-vlc__buffering" aria-live="polite">
          <div className="spinner" />
          <div className="label">読み込み中 · Buffering</div>
        </div>
      )}

      {/* Pre-roll "Now playing" card — first canplay only. Mounted under a
          keyed wrapper so a new src always re-runs the fade animation rather
          than persisting a stale frame. CSS handles the entire timeline
          (fade-in → hold → fade-out); we just unmount once the animation
          settles. */}
      {prerollVisible && (
        <PreRollCard
          key={prerollKey}
          title={title}
          durationSec={duration}
          onComplete={() => setPrerollVisible(false)}
        />
      )}

      {/* Resume pill — appears once metadata loads when the parent supplied
          a saved position. Auto-confirms after RESUME_AUTO_MS; "Restart"
          cancels and starts from 0. */}
      {resumePill && (
        <ResumePill
          positionSec={resumePill.positionSec}
          status={resumePill.status}
          onResume={applyResume}
          onRestart={cancelResume}
        />
      )}

      {/* Keyboard shortcuts cheatsheet (toggle with `?`). Mounted always when
          open so the close-on-Esc + close-on-click handlers attach cleanly. */}
      {shortcutsOpen && (
        <ShortcutsOverlay
          skipSeconds={settings.skipSeconds}
          onClose={() => setShortcutsOpen(false)}
        />
      )}

      {/* Next-up card — visible during the last NEXT_UP_THRESHOLD_SEC of the
          episode when autoplay-next is on. Floats above the HUD so the timeline
          stays interactive underneath. Auto-advance happens on the `ended`
          event, not on this countdown — the countdown is purely informational. */}
      {nextVideo &&
        !nextUpDismissed &&
        settings.autoplayNext &&
        duration > 0 &&
        duration - currentTime <= NEXT_UP_THRESHOLD_SEC &&
        duration - currentTime > 0 && (
          <NextUpCard
            next={nextVideo}
            remainingSec={Math.max(0, Math.ceil(duration - currentTime))}
            onPlayNow={() => onNext?.()}
            onDismiss={() => setNextUpDismissed(true)}
          />
        )}

      {/* Bottom HUD */}
      <div className="dc-vlc__hud">
        <div className="dc-vlc__timeline-head" aria-live="off">
          <span>{formatTimecode(displayTime)}</span>
          <span>{formatTimecode(duration)}</span>
        </div>
        <div
          ref={timelineRef}
          className={cn("dc-vlc__timeline", {
            "is-scrubbing": scrubbing,
            "is-disabled": !duration,
          })}
          role="slider"
          tabIndex={duration ? 0 : -1}
          aria-label="Playback timeline"
          aria-valuemin={0}
          aria-valuemax={Math.max(0, Math.round(duration))}
          aria-valuenow={Math.max(0, Math.round(displayTime))}
          aria-valuetext={`${formatTimecode(displayTime)} of ${formatTimecode(duration)}`}
          aria-disabled={!duration}
          onPointerMove={onTimelinePointerMove}
          onPointerLeave={onTimelinePointerLeave}
          onPointerDown={onTimelinePointerDown}
          onPointerUp={finishTimelinePointer}
          onPointerCancel={finishTimelinePointer}
          onKeyDown={onTimelineKeyDown}
        >
          <div className="dc-vlc__timeline-track">
            <div
              className="dc-vlc__tl-buffered"
              style={{ width: `${bufferedPct}%` }}
            />
            <div
              className="dc-vlc__tl-progress"
              style={{ width: `${playedPct}%` }}
            />
            <div
              className="dc-vlc__tl-thumb"
              style={{ left: `${playedPct}%` }}
            />
          </div>
          {hoverTime !== null && (
            <div
              className={cn("dc-vlc__tl-preview", {
                "has-frame": previewStatus === "ready",
              })}
              style={{ left: `${hoverX * 100}%` }}
            >
              <canvas
                ref={previewCanvasRef}
                width={176}
                height={99}
                aria-hidden
              />
              <span>{formatTimecode(hoverTime)}</span>
              {previewStatus === "loading" && <em>Loading</em>}
              {previewStatus === "unavailable" && <em>Preview unavailable</em>}
            </div>
          )}
        </div>

        <div className="dc-vlc__bar">
          {/* Prev */}
          <button
            type="button"
            className="dc-vlc__btn"
            onClick={onPrev}
            disabled={!prevVideo || !onPrev}
            title={
              prevVideo ? `Previous: ${prevVideo.title} (P)` : "No previous episode"
            }
            aria-label="Previous video"
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
            </svg>
          </button>

          <button
            type="button"
            className="dc-vlc__btn dc-vlc__play"
            onClick={togglePlay}
            title={playing ? "Pause (Space)" : "Play (Space)"}
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M8 5v14l11-7L8 5z" />
              </svg>
            )}
          </button>

          {/* Next */}
          <button
            type="button"
            className="dc-vlc__btn"
            onClick={onNext}
            disabled={!nextVideo || !onNext}
            title={nextVideo ? `Next: ${nextVideo.title} (N)` : "No next episode"}
            aria-label="Next video"
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2z" />
            </svg>
          </button>

          <div className="dc-vlc__spacer" />

          {/* PiP */}
          {"pictureInPictureEnabled" in document && (
            <button
              type="button"
              className="dc-vlc__btn"
              onClick={togglePiP}
              title="Picture-in-picture"
              aria-label="Toggle picture-in-picture"
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M19 11h-8v6h8v-6zm4 8V5c0-1.1-.9-2-2-2H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 0H3V5h18v14z" />
              </svg>
            </button>
          )}

          {/* Theatre mode — dims the page chrome around the player so the
              frame reads as a cinema room without committing to fullscreen.
              Only rendered when the parent page wires the toggle. */}
          {onToggleTheatre && (
            <button
              type="button"
              className={cn("dc-vlc__btn", { "is-on": theatreMode })}
              onClick={onToggleTheatre}
              title={theatreMode ? "Exit theatre mode" : "Theatre mode"}
              aria-label="Toggle theatre mode"
              aria-pressed={!!theatreMode}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M3 6h18v2H3V6zm0 4h18v8H3v-8zm2 2v4h14v-4H5z" />
              </svg>
            </button>
          )}

          {/* Settings (gear) */}
          <div className="dc-vlc__menu-host dc-vlc__menu-host--settings">
            <button
              type="button"
              className={cn("dc-vlc__btn", { "is-on": showSettings })}
              onClick={() => setShowSettings((v) => !v)}
              title="Player settings"
              aria-label="Player settings"
              aria-expanded={showSettings}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M19.43 12.98c.04-.32.07-.64.07-.98s-.03-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.03 7.03 0 0 0-1.69-.98l-.38-2.65A.488.488 0 0 0 14 2h-4a.488.488 0 0 0-.49.42l-.38 2.65c-.61.25-1.17.58-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .61.22l2.49-1c.52.4 1.08.73 1.69.98l.38 2.65c.04.24.25.42.49.42h4c.24 0 .45-.18.49-.42l.38-2.65c.61-.25 1.17-.58 1.69-.98l2.49 1a.5.5 0 0 0 .61-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z" />
              </svg>
            </button>
            {showSettings && (
              <SettingsPopover
                onClose={() => setShowSettings(false)}
                audioTracks={audioTracks}
                activeAudioId={activeAudioId}
                onPickAudio={pickAudioTrack}
                subtitleTracks={subtitleTracks}
                activeSubId={activeSubId}
                onPickSubtitle={pickSub}
                subDelay={subDelay}
                onAdjustSubDelay={adjustSubDelay}
                volumePct={volPct}
                muted={muted || volume === 0}
                onSetVolumePct={setVideoVolumePct}
                onToggleMute={toggleMute}
                speed={speed}
                speeds={SPEEDS}
                onChangeSpeed={changeSpeed}
                looping={looping}
                onToggleLoop={toggleLoop}
              />
            )}
          </div>

          {/* Fullscreen */}
          <button
            type="button"
            className="dc-vlc__btn"
            onClick={toggleFullscreen}
            title={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
            aria-label="Toggle fullscreen"
          >
            {isFullscreen ? (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M14 14h5v2h-3v3h-2v-5zm-9 0h5v5H8v-3H5v-2zm9-9V0h2v3h3v2h-5zm-9 0V0h2v5H3V3h2z" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
              </svg>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

function subtitleTrackBadge(track: SubtitleTrack): string {
  if (track.imageBased || track.format === "image") return "IMG";
  if (track.assRenderer === "jassub") return "JASSUB";
  if (track.format) return track.format.toUpperCase();
  return track.lang.toUpperCase();
}

function describeSubtitleStatus({
  activeSubId,
  activeTrack,
  trackCount,
  useJassub,
  jassubIntended,
  jassubFailed,
}: {
  activeSubId: string | null;
  activeTrack: SubtitleTrack | null;
  trackCount: number;
  useJassub: boolean;
  jassubIntended: boolean;
  jassubFailed: boolean;
}): {
  label: string;
  detail: string;
  title: string;
  tone: "ready" | "off" | "loading" | "unsupported";
} {
  if (trackCount === 0) {
    return {
      label: "No subtitles",
      detail: "No tracks",
      title: "No subtitle tracks have been detected for this video.",
      tone: "off",
    };
  }
  if (activeSubId === null) {
    return {
      label: "Subtitles off",
      detail: `${trackCount} track${trackCount === 1 ? "" : "s"}`,
      title: "Subtitle tracks are available, but none is currently selected.",
      tone: "off",
    };
  }
  if (!activeTrack) {
    return {
      label: "Loading subtitles",
      detail: "Selecting",
      title: "The selected subtitle track is being refreshed.",
      tone: "loading",
    };
  }
  // PGS tracks that finished decoding ship `pgsCompositions` and flip
  // `imageBased` to false in PlayerPage — they fall through to the regular
  // status line below ("Embedded IMG · PGS · N cues"). The branch here only
  // catches still-image-based tracks (VobSub, or PGS while extracting).
  if (activeTrack.imageBased || activeTrack.format === "image") {
    const isPgs = activeTrack.codecId
      ?.toUpperCase()
      .replace(/\s/g, "")
      .includes("PGS");
    return {
      label: "Image subtitles",
      detail: isPgs ? "Decoding" : "Unsupported",
      title: isPgs
        ? "Blu-ray PGS bitmaps are still being extracted from the file."
        : "VobSub (DVD) image subtitles are not decoded.",
      tone: isPgs ? "loading" : "unsupported",
    };
  }
  if (activeTrack.pgsCompositions && activeTrack.pgsCompositions.length > 0) {
    return {
      label: `Embedded ${subtitleTrackBadge(activeTrack)}`,
      detail: `canvas · ${activeTrack.pgsCompositions.length} cues`,
      title: `${activeTrack.label} renders Blu-ray bitmaps via canvas overlay.`,
      tone: "ready",
    };
  }

  const source = activeTrack.source === "embedded" ? "Embedded" : "External";
  const format = subtitleTrackBadge(activeTrack);
  const cueCount = activeTrack.cues.length;
  const loading = activeTrack.source === "embedded" && cueCount === 0;
  // Renderer label tracks the live state:
  //   - useJassub:                 libass actually has the canvas
  //   - jassubIntended && !failed: libass is booting; CSS bridges the gap
  //   - jassubFailed:              libass crashed/CSP — CSS is final
  //   - !jassubIntended:           SRT/VTT/text path, CSS by design
  const renderer = useJassub
    ? "libass"
    : jassubIntended && !jassubFailed
      ? "libass·boot"
      : jassubFailed
        ? "CSS·libass-failed"
        : "CSS";
  return {
    label: `${source} ${format}`,
    detail: loading ? "Loading cues" : `${renderer} · ${cueCount} cues`,
    title: `${activeTrack.label} renders with ${renderer}.`,
    tone: loading ? "loading" : "ready",
  };
}

// ---------------------------------------------------------------------------
// Pre-roll "Now playing" card
//
// Briefly overlays the series + episode + runtime over the first frame after
// canplay. The split is purely visual: the first segment of the parsed title
// (everything before " - ") becomes the show name; the rest becomes the
// episode marker. Fade timeline lives in CSS — we just unmount on animation
// end so React doesn't keep a hidden node around.
// ---------------------------------------------------------------------------

function PreRollCard({
  title,
  durationSec,
  onComplete,
}: {
  title: string | undefined;
  durationSec: number;
  onComplete: () => void;
}) {
  const { show, episode } = useMemo(() => splitPreRollTitle(title), [title]);
  const runtime = useMemo(
    () => formatRuntimeShort(durationSec),
    [durationSec],
  );
  return (
    <div
      className="dc-vlc__preroll"
      role="status"
      aria-live="polite"
      onAnimationEnd={(e) => {
        // The outer wrapper has two animations chained via CSS; the second
        // one (`dc-vlc-preroll-out`) is the last to finish, so completion
        // here means the whole card has faded out.
        if (e.animationName === "dc-vlc-preroll-out") onComplete();
      }}
    >
      <div className="dc-vlc__preroll-frame">
        <span className="dc-vlc__preroll-kana">再生中 · NOW PLAYING</span>
        {show && <span className="dc-vlc__preroll-show">{show}</span>}
        <div className="dc-vlc__preroll-meta">
          {episode && (
            <span className="dc-vlc__preroll-episode">{episode}</span>
          )}
          {runtime && (
            <span className="dc-vlc__preroll-runtime">{runtime}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function splitPreRollTitle(title: string | undefined): {
  show: string;
  episode: string;
} {
  if (!title) return { show: "", episode: "" };
  // Parsed full titles use " - " as the separator between show and
  // episode/special. Anything without the separator is treated as a single
  // show label (movies, one-shots).
  const idx = title.indexOf(" - ");
  if (idx === -1) return { show: title, episode: "" };
  return {
    show: title.slice(0, idx),
    episode: title.slice(idx + 3),
  };
}

function formatRuntimeShort(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return "";
  const totalMin = Math.round(durationSec / 60);
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Smart-resume pill
//
// Floats at the top-left of the player when the parent supplied an
// initialSeek. Auto-resumes after RESUME_AUTO_MS so the common case stays
// click-free; the user can still bail to a fresh start via "Restart". The
// "resumed" / "restarted" terminal states get a brief confirmation render
// before the pill animates out (handled by the parent's setTimeout).
// ---------------------------------------------------------------------------

function ResumePill({
  positionSec,
  status,
  onResume,
  onRestart,
}: {
  positionSec: number;
  status: "pending" | "resumed" | "restarted";
  onResume: () => void;
  onRestart: () => void;
}) {
  const timecode = formatTimecode(positionSec);
  return (
    <div
      className={cn("dc-vlc__resume", `is-${status}`)}
      role="status"
      aria-live="polite"
    >
      {status === "pending" && (
        <>
          <span className="dc-vlc__resume-kana">続きから · RESUME</span>
          <span className="dc-vlc__resume-time">{timecode}</span>
          <div className="dc-vlc__resume-actions">
            <button
              type="button"
              className="dc-vlc__resume-btn dc-vlc__resume-btn--primary"
              onClick={onResume}
            >
              Resume now
            </button>
            <button
              type="button"
              className="dc-vlc__resume-btn"
              onClick={onRestart}
            >
              Restart
            </button>
          </div>
          <div className="dc-vlc__resume-progress" aria-hidden />
        </>
      )}
      {status === "resumed" && (
        <span className="dc-vlc__resume-kana">→ {timecode}</span>
      )}
      {status === "restarted" && (
        <span className="dc-vlc__resume-kana">↶ RESTART</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Next-up autoplay card
//
// Renders in the bottom-right above the HUD during the last few seconds of
// an episode. Shows the next file's poster (or a brand fallback), the parsed
// display title, and a live countdown. The card is informational only — the
// actual jump happens on the <video>'s `ended` event so the user always sees
// the full final frame before the transition.
// ---------------------------------------------------------------------------

function NextUpCard({
  next,
  remainingSec,
  onPlayNow,
  onDismiss,
}: {
  next: NonNullable<Props["nextVideo"]>;
  remainingSec: number;
  onPlayNow: () => void;
  onDismiss: () => void;
}) {
  const label = next.displayTitle || next.title;
  return (
    <div className="dc-vlc__nextup" role="region" aria-label="Up next">
      <div className="dc-vlc__nextup-poster">
        {next.posterUrl ? (
          <img src={next.posterUrl} alt="" loading="lazy" decoding="async" />
        ) : (
          <div className="dc-vlc__nextup-poster-fallback" aria-hidden />
        )}
      </div>
      <div className="dc-vlc__nextup-body">
        <span className="dc-vlc__nextup-kana">
          次のエピソード · UP NEXT IN {remainingSec}S
        </span>
        <span className="dc-vlc__nextup-title" title={label}>
          {label}
        </span>
        <div className="dc-vlc__nextup-actions">
          <button
            type="button"
            className="dc-vlc__nextup-btn dc-vlc__nextup-btn--primary"
            onClick={onPlayNow}
          >
            Play now
          </button>
          <button
            type="button"
            className="dc-vlc__nextup-btn"
            onClick={onDismiss}
          >
            Stay
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shortcuts cheatsheet
//
// Toggled with `?`. Closes on Esc or click outside the card. Keys are grouped
// by intent so a glance is enough to find what you need.
// ---------------------------------------------------------------------------

function ShortcutsOverlay({
  skipSeconds,
  onClose,
}: {
  skipSeconds: number;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const groups: Array<{ title: string; rows: Array<[string, string]> }> = [
    {
      title: "再生 · Playback",
      rows: [
        ["Space  K", "Play / pause"],
        ["←  →", `Skip ±${skipSeconds}s`],
        ["J  L", "Skip ±30s"],
        ["Home  End", "Jump to start / near end"],
        ["0 – 9", "Jump to 0 – 90 %"],
        ["<  >", "Speed −0.25× / +0.25×"],
      ],
    },
    {
      title: "音量 · Audio & View",
      rows: [
        ["↑  ↓", "Volume ±5 %"],
        ["M", "Mute"],
        ["F", "Toggle fullscreen"],
        ["Esc", "Exit fullscreen / close this"],
      ],
    },
    {
      title: "字幕 · Subtitles",
      rows: [
        ["C", "Cycle subtitle track"],
        [",  .", "Sub delay −0.5s / +0.5s"],
        ["+  −", "Sub size up / down"],
      ],
    },
    {
      title: "プレイリスト · Playlist",
      rows: [
        ["N", "Next episode"],
        ["P", "Previous episode"],
        ["?  /", "Show / hide this overlay"],
      ],
    },
  ];

  return (
    <div
      className="dc-vlc__shortcuts"
      role="dialog"
      aria-label="Keyboard shortcuts"
      onClick={onClose}
    >
      <div
        className="dc-vlc__shortcuts-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dc-vlc__shortcuts-head">
          <span className="dc-vlc__shortcuts-kana">
            ショートカット · KEYBOARD
          </span>
          <button
            type="button"
            className="dc-vlc__shortcuts-close"
            onClick={onClose}
            aria-label="Close shortcuts"
          >
            ×
          </button>
        </div>
        <div className="dc-vlc__shortcuts-grid">
          {groups.map((g) => (
            <div key={g.title} className="dc-vlc__shortcuts-group">
              <div className="dc-vlc__shortcuts-group-title">{g.title}</div>
              <ul>
                {g.rows.map(([keys, label]) => (
                  <li key={keys}>
                    <kbd>{keys}</kbd>
                    <span>{label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
