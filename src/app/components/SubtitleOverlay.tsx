/**
 * SubtitleOverlay — renders parsed subtitle cues on top of the video.
 *
 * Replaces the native <track> element so we can control styling, delay,
 * font size, and ASS positioning precisely. Syncs to the parent video's
 * currentTime via a requestAnimationFrame loop.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { SubCue } from "../services/subtitles";
import "./SubtitleOverlay.scss";

interface Props {
  /** Reference to the <video> element we should sync against. */
  videoRef: React.RefObject<HTMLVideoElement>;
  /** The currently active subtitle track (null = off). */
  cues: SubCue[];
  /** Delay offset in seconds (positive = show later, negative = show earlier). */
  delay: number;
  /** Font-size multiplier; 1.0 = 100 %. Settings clamps to 0.5..2.0. */
  scale: number;
  /** CSS font-family value (already a stack, see services/subtitle-font.ts). */
  fontFamily: string;
  /** CSS font-weight (400..900). */
  fontWeight: number;
  /** Hex fill color for cue text. */
  color: string;
  /** Hex stroke color painted under each glyph. */
  outlineColor: string;
  /** Stroke width in px (0 disables outline). */
  outlineWidth: number;
  /** Soft-shadow strength multiplier (0..2). */
  shadowStrength: number;
  /** CSS letter-spacing in em. */
  letterSpacing: number;
  /** Fraction of viewport-height to lift bottom cues off the bottom edge. */
  bottomOffset: number;
  /** Whether the player is in fullscreen. */
  isFullscreen: boolean;
}

export function SubtitleOverlay({
  videoRef,
  cues,
  delay,
  scale,
  fontFamily,
  fontWeight,
  color,
  outlineColor,
  outlineWidth,
  shadowStrength,
  letterSpacing,
  bottomOffset,
  isFullscreen,
}: Props) {
  const [active, setActive] = useState<SubCue[]>([]);
  const rafRef = useRef<number>(0);
  const prevActiveRef = useRef<Set<string>>(new Set());

  // Keep a sorted copy for binary search
  const sorted = useMemo(
    () => [...cues].sort((a, b) => a.start - b.start),
    [cues],
  );

  useEffect(() => {
    function tick() {
      const v = videoRef.current;
      if (!v) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      const t = v.currentTime - delay;

      // Find active cues with binary search bounds
      const nowActive: SubCue[] = [];
      for (const cue of sorted) {
        if (cue.start <= t && cue.end > t) {
          nowActive.push(cue);
        } else if (cue.start > t) {
          break;
        }
      }

      setActive((prev) => {
        const prevIds = new Set(prev.map((c) => c.id));
        const nextIds = new Set(nowActive.map((c) => c.id));
        // Only update if the set changed to avoid thrashing
        if (
          prevIds.size === nextIds.size &&
          [...prevIds].every((id) => nextIds.has(id))
        ) {
          return prev;
        }
        prevActiveRef.current = prevIds;
        return nowActive;
      });

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [sorted, delay, videoRef]);

  if (sorted.length === 0) return null;

  // Split cues by vertical position preference
  const top: SubCue[] = [];
  const bottom: SubCue[] = [];
  for (const cue of active) {
    const pos = cue.styles?.linePosition;
    if (pos !== undefined && pos < 50) {
      top.push(cue);
    } else {
      bottom.push(cue);
    }
  }

  // Drive font-size + family from the user-controlled settings via CSS
  // variables on the overlay root, so SCSS can multiply through `calc()` and
  // every cue inherits without per-element style props.
  const overlayStyle = {
    "--dc-sub-scale": String(scale),
    "--dc-sub-font": fontFamily,
    "--dc-sub-weight": String(fontWeight),
    "--dc-sub-color": color,
    "--dc-sub-stroke-color": outlineColor,
    "--dc-sub-stroke-width": `${outlineWidth}px`,
    "--dc-sub-shadow": String(shadowStrength),
    "--dc-sub-letter-spacing": `${letterSpacing}em`,
    // Convert the 0..1 viewport fraction into a CSS length the SCSS uses for
    // bottom padding. Capped at 50 % to keep cues on screen.
    "--dc-sub-bottom-offset": `${Math.max(0, Math.min(0.5, bottomOffset)) * 100}%`,
  } as CSSProperties;

  return (
    <div
      className={`dc-sub-overlay ${isFullscreen ? "is-fs" : ""}`}
      style={overlayStyle}
    >
      <div className="dc-sub-zone dc-sub-zone--top">
        {top.map((cue) => (
          <CueLine key={cue.id} cue={cue} />
        ))}
      </div>
      <div className="dc-sub-zone dc-sub-zone--bottom">
        {bottom.map((cue) => (
          <CueLine key={cue.id} cue={cue} />
        ))}
      </div>
    </div>
  );
}

function CueLine({ cue }: { cue: SubCue }) {
  const styles = cue.styles;
  // Per-cue colors only override the user setting when the source track
  // (ASS) actually specified one; otherwise inherit through the CSS var so
  // the SettingsPopover color picker takes effect.
  const inlineColor = styles?.color || undefined;
  return (
    <span
      className="dc-sub-cue"
      data-bold={styles?.bold ?? false}
      data-italic={styles?.italic ?? false}
      data-underline={styles?.underline ?? false}
      data-align={styles?.align ?? "center"}
      style={inlineColor ? { color: inlineColor } : undefined}
    >
      {cue.text}
    </span>
  );
}
