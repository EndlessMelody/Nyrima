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
import { SubtitleOverlay, type SubSize } from "./SubtitleOverlay";
import type { SubCue } from "../services/subtitles";
import { EMPTY_CUES } from "../services/subtitles";
import { formatTimecode } from "../services/formatters";

export interface SubtitleTrack {
  id: string;
  lang: string;
  label: string;
  cues: SubCue[];
  imageBased?: boolean;
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
  /** Called when the <video> emits a fatal error. */
  onMediaError?: (err: MediaError | null) => void;
  /** Called once metadata is known. */
  onLoadedMetadata?: (duration: number) => void;
  /** Called every timeupdate; useful for persisting playback position. */
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  /** Exposes the raw <video> element so the parent can attach MSE. */
  onVideoRef?: (el: HTMLVideoElement | null) => void;
  nextVideo?: { fileId: string; title: string } | null;
  prevVideo?: { fileId: string; title: string } | null;
  onNext?: () => void;
  onPrev?: () => void;
}

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];
const SUB_SIZES: SubSize[] = ["xs", "sm", "md", "lg", "xl"];

export function DrivePlayer({
  src,
  subtitleTracks,
  title,
  initialSeek,
  onMediaError,
  onLoadedMetadata,
  onTimeUpdate,
  onVideoRef,
  nextVideo,
  prevVideo,
  onNext,
  onPrev,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<number | null>(null);

  // Stash callback props in a ref so the <video> event-binding effect only
  // runs once. Without this, every parent render that produces fresh
  // callback identities tears down and re-attaches all 12 media listeners.
  const callbacksRef = useRef({ onMediaError, onLoadedMetadata, onTimeUpdate });
  useEffect(() => {
    callbacksRef.current = { onMediaError, onLoadedMetadata, onTimeUpdate };
  });

  // Track whether we've already applied the parent-supplied initialSeek so
  // subsequent `loadedmetadata` events (e.g. user reload) don't re-seek.
  const initialSeekAppliedRef = useRef(false);
  useEffect(() => {
    initialSeekAppliedRef.current = false;
  }, [src, initialSeek]);

  // Video state mirror -------------------------------------------------------
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [bufferedEnd, setBufferedEnd] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [buffering, setBuffering] = useState(true);
  const [looping, setLooping] = useState(false);

  // Subtitle state -----------------------------------------------------------
  const [activeSubId, setActiveSubId] = useState<string | null>(null);
  const [subDelay, setSubDelay] = useState(0);
  const [subSizeIdx, setSubSizeIdx] = useState(2); // md

  // Auto-select first non-image-based subtitle track when tracks load
  useEffect(() => {
    if (activeSubId !== null) return;
    const firstText = subtitleTracks.find((t) => !t.imageBased);
    if (firstText) {
      setActiveSubId(firstText.id);
    }
  }, [subtitleTracks, activeSubId]);

  // UI state ----------------------------------------------------------------
  const [hudOn, setHudOn] = useState(true);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverX, setHoverX] = useState<number>(0);
  const [scrubbing, setScrubbing] = useState(false);
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
      loadedmetadata: () => {
        const dur = isFinite(v.duration) ? v.duration : 0;
        setDuration(dur);
        setBuffering(false);
        // Apply parent-supplied resume seek once, in-element, so the parent
        // doesn't need to reach into the player DOM.
        const seek = initialSeek ?? 0;
        if (
          !initialSeekAppliedRef.current &&
          seek > 0 &&
          dur > 0 &&
          seek < dur - 2
        ) {
          v.currentTime = seek;
          initialSeekAppliedRef.current = true;
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
      canplay: () => setBuffering(false),
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
      setShowSubMenu(false);
      setShowSpeedMenu(false);
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
      if (t?.closest(".dc-vlc__menu, .dc-vlc__vol-rail")) return;
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
          v.currentTime = Math.max(0, v.currentTime - 10);
          kickIdleTimer();
          break;
        case "arrowright":
          e.preventDefault();
          v.currentTime = Math.min(v.duration || 0, v.currentTime + 10);
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
          setSubSizeIdx((i) => Math.min(SUB_SIZES.length - 1, i + 1));
          kickIdleTimer();
          break;
        case "-":
        case "_":
          e.preventDefault();
          setSubSizeIdx((i) => Math.max(0, i - 1));
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
        default:
          return;
      }
    }
    c.tabIndex = 0;
    c.addEventListener("keydown", onKey);
    return () => c.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subtitleTracks.length, playing, onNext, onPrev]);

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

  function changeSpeed(s: number) {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = s;
    setShowSpeedMenu(false);
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
    setShowSubMenu(false);
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

  function cycleSubSize() {
    setSubSizeIdx((i) => (i + 1) % SUB_SIZES.length);
  }

  // Timeline scrubbing -------------------------------------------------------
  function pctFromEvent(e: { clientX: number }): number {
    const t = timelineRef.current;
    if (!t) return 0;
    const rect = t.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  }

  function onTimelineMouseMove(e: React.MouseEvent) {
    if (!duration) return;
    const pct = pctFromEvent(e);
    setHoverTime(pct * duration);
    setHoverX(pct);
  }

  function onTimelineMouseLeave() {
    setHoverTime(null);
  }

  function onTimelineMouseDown(e: React.MouseEvent) {
    if (!duration) return;
    setScrubbing(true);
    const v = videoRef.current;
    const t0 = pctFromEvent(e) * duration;
    if (v) v.currentTime = t0;

    function onMove(ev: MouseEvent) {
      const pct = pctFromEvent(ev);
      setHoverTime(pct * duration);
      setHoverX(pct);
      if (v) v.currentTime = pct * duration;
    }
    function onUp() {
      setScrubbing(false);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const playedPct = useMemo(() => {
    if (!duration) return 0;
    return (currentTime / duration) * 100;
  }, [currentTime, duration]);

  const bufferedPct = useMemo(() => {
    if (!duration) return 0;
    return (bufferedEnd / duration) * 100;
  }, [bufferedEnd, duration]);

  const volPct = Math.round(volume * 100);

  // Stable empty-cues reference so SubtitleOverlay's memo doesn't bust when
  // no track matches activeSubId.
  const activeCues = useMemo(
    () =>
      (subtitleTracks.find((t) => t.id === activeSubId)?.cues as
        | SubCue[]
        | undefined) ?? (EMPTY_CUES as SubCue[]),
    [subtitleTracks, activeSubId],
  );

  return (
    <div
      ref={containerRef}
      className={cn("dc-vlc", {
        "is-hud-on": hudOn || !playing,
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

      <SubtitleOverlay
        videoRef={videoRef}
        cues={activeCues}
        delay={subDelay}
        size={SUB_SIZES[subSizeIdx]}
        isFullscreen={isFullscreen}
      />

      {/* Four corner brackets */}
      <div className="dc-vlc__corners" aria-hidden>
        <span className="tl" />
        <span className="tr" />
        <span className="bl" />
        <span className="br" />
      </div>

      {/* Top kana eyebrow */}
      <div className="dc-vlc__top">
        <span className="dc-vlc__top-kana">
          {playing ? "再生中 · NOW PLAYING" : "一時停止 · PAUSED"}
        </span>
        {title && <span className="dc-vlc__top-title">{title}</span>}
      </div>

      {/* Center resume knob */}
      {!playing && !buffering && (
        <button
          type="button"
          className="dc-vlc__center"
          onClick={togglePlay}
          aria-label="Play"
        >
          <span className="dc-vlc__center-knob">
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M8 5v14l11-7L8 5z" />
            </svg>
          </span>
        </button>
      )}

      {/* Buffering spinner */}
      {buffering && (
        <div className="dc-vlc__buffering" aria-live="polite">
          <div className="spinner" />
          <div className="label">読み込み中 · Buffering</div>
        </div>
      )}

      {/* Bottom HUD */}
      <div className="dc-vlc__hud">
        <div
          ref={timelineRef}
          className={cn("dc-vlc__timeline", { "is-scrubbing": scrubbing })}
          onMouseMove={onTimelineMouseMove}
          onMouseLeave={onTimelineMouseLeave}
          onMouseDown={onTimelineMouseDown}
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
              className="dc-vlc__tl-preview"
              style={{ left: `${hoverX * 100}%` }}
            >
              {formatTimecode(hoverTime)}
            </div>
          )}
        </div>

        <div className="dc-vlc__bar">
          {/* Prev */}
          {prevVideo && (
            <button
              type="button"
              className="dc-vlc__btn"
              onClick={onPrev}
              title={`Previous: ${prevVideo.title} (P)`}
              aria-label="Previous video"
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M6 6h2v12H6zm3.5 6 8.5 6V6z" />
              </svg>
            </button>
          )}

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
          {nextVideo && (
            <button
              type="button"
              className="dc-vlc__btn"
              onClick={onNext}
              title={`Next: ${nextVideo.title} (N)`}
              aria-label="Next video"
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M6 18l8.5-6L6 6v12zM16 6h2v12h-2z" />
              </svg>
            </button>
          )}

          <div className="dc-vlc__time" aria-live="off">
            <span>{formatTimecode(currentTime)}</span>
            <span className="sep">/</span>
            <span className="total">{formatTimecode(duration)}</span>
          </div>

          <div className="dc-vlc__spacer" />

          {/* Volume */}
          <div className="dc-vlc__vol">
            <button
              type="button"
              className="dc-vlc__btn"
              onClick={toggleMute}
              title={muted || volume === 0 ? "Unmute (M)" : "Mute (M)"}
              aria-label="Toggle mute"
            >
              {muted || volume === 0 ? (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M16.5 12A4.5 4.5 0 0 0 14 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.95 8.95 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z" />
                </svg>
              ) : volume > 0.5 ? (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" aria-hidden>
                  <path d="M7 9v6h4l5 5V4l-5 5H7z" />
                </svg>
              )}
            </button>
            <div className="dc-vlc__vol-rail" onMouseEnter={kickIdleTimer}>
              <input
                type="range"
                min={0}
                max={100}
                step={1}
                value={muted ? 0 : volPct}
                onChange={(e) => {
                  const v = videoRef.current;
                  if (!v) return;
                  const pct = Number(e.target.value);
                  v.volume = pct / 100;
                  if (pct > 0) v.muted = false;
                }}
                className="dc-vlc__range"
                style={{
                  ["--pct" as never]: `${muted ? 0 : volPct}%`,
                }}
                aria-label="Volume"
              />
            </div>
          </div>

          {/* Subtitles */}
          <div className="dc-vlc__menu-host">
            <button
              type="button"
              className={cn("dc-vlc__btn", { "is-on": activeSubId !== null })}
              onClick={() => {
                setShowSpeedMenu(false);
                setShowSubMenu((v) => !v);
              }}
              title="Subtitles (C)"
              aria-label="Subtitles"
              aria-expanded={showSubMenu}
            >
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zM4 12h4v2H4v-2zm10 6H4v-2h10v2zm6 0h-4v-2h4v2zm0-4H10v-2h10v2z" />
              </svg>
            </button>
            {showSubMenu && (
              <div className="dc-vlc__menu" role="menu">
                <div className="dc-vlc__menu-kana">字幕 · Subtitles</div>
                <button
                  type="button"
                  className={cn("dc-vlc__menu-item", {
                    "is-active": activeSubId === null,
                  })}
                  onClick={() => pickSub(null)}
                  role="menuitem"
                >
                  <span>Off</span>
                  <span className="dc-vlc__menu-side">—</span>
                </button>
                {subtitleTracks.length === 0 && (
                  <div
                    className="dc-vlc__menu-item is-disabled"
                    style={{ cursor: "default" }}
                  >
                    <span>No subtitles found</span>
                  </div>
                )}
                {subtitleTracks.map((s) => (
                  <button
                    type="button"
                    key={s.id}
                    className={cn("dc-vlc__menu-item", {
                      "is-active": activeSubId === s.id,
                      "is-disabled": s.imageBased,
                    })}
                    onClick={() => {
                      if (!s.imageBased) pickSub(s.id);
                    }}
                    role="menuitem"
                    title={
                      s.imageBased
                        ? `${s.label} — image-based subtitles can't be rendered in-browser`
                        : s.label
                    }
                    disabled={s.imageBased}
                  >
                    <span>{s.label}</span>
                    <span className="dc-vlc__menu-side">
                      {s.imageBased ? "IMG" : s.lang.toUpperCase()}
                    </span>
                  </button>
                ))}
                {subtitleTracks.length > 0 && (
                  <>
                    <div className="dc-vlc__menu-divider" />
                    <div className="dc-vlc__menu-row">
                      <button
                        type="button"
                        className="dc-vlc__menu-mini"
                        onClick={() => adjustSubDelay(-0.5)}
                        title="Earlier (, )"
                      >
                        −0.5s
                      </button>
                      <span className="dc-vlc__menu-mid">
                        {subDelay > 0
                          ? `+${subDelay.toFixed(1)}s`
                          : `${subDelay.toFixed(1)}s`}
                      </span>
                      <button
                        type="button"
                        className="dc-vlc__menu-mini"
                        onClick={() => adjustSubDelay(0.5)}
                        title="Later ( . )"
                      >
                        +0.5s
                      </button>
                    </div>
                    <button
                      type="button"
                      className="dc-vlc__menu-item"
                      onClick={cycleSubSize}
                      role="menuitem"
                    >
                      <span>Font size</span>
                      <span className="dc-vlc__menu-side">
                        {SUB_SIZES[subSizeIdx]}
                      </span>
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Speed */}
          <div className="dc-vlc__menu-host">
            <button
              type="button"
              className={cn("dc-vlc__btn", "dc-vlc__btn--text", {
                "is-on": speed !== 1,
              })}
              onClick={() => {
                setShowSubMenu(false);
                setShowSpeedMenu((v) => !v);
              }}
              title="Playback speed"
              aria-label="Playback speed"
              aria-expanded={showSpeedMenu}
            >
              {speed}x
            </button>
            {showSpeedMenu && (
              <div className="dc-vlc__menu" role="menu">
                <div className="dc-vlc__menu-kana">速度 · Speed</div>
                {SPEEDS.map((s) => (
                  <button
                    type="button"
                    key={s}
                    className={cn("dc-vlc__menu-item", {
                      "is-active": Math.abs(speed - s) < 0.01,
                    })}
                    onClick={() => changeSpeed(s)}
                    role="menuitem"
                  >
                    <span>{s}x</span>
                    <span className="dc-vlc__menu-side">
                      {s === 1 ? "Normal" : s < 1 ? "Slow" : "Fast"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Loop */}
          <button
            type="button"
            className={cn("dc-vlc__btn", { "is-on": looping })}
            onClick={toggleLoop}
            title={looping ? "Loop on" : "Loop off"}
            aria-label="Toggle loop"
          >
            <svg viewBox="0 0 24 24" aria-hidden>
              <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z" />
            </svg>
          </button>

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
