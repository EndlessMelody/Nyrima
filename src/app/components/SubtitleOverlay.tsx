/**
 * SubtitleOverlay — renders parsed subtitle cues on top of the video.
 *
 * Replaces the native <track> element so we can control styling, delay,
 * font size, and ASS positioning precisely. Syncs to the parent video's
 * currentTime via a requestAnimationFrame loop.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { SubCue } from "../services/subtitles";
import "./SubtitleOverlay.scss";

export type SubSize = "xs" | "sm" | "md" | "lg" | "xl";

interface Props {
  /** Reference to the <video> element we should sync against. */
  videoRef: React.RefObject<HTMLVideoElement>;
  /** The currently active subtitle track (null = off). */
  cues: SubCue[];
  /** Delay offset in seconds (positive = show later, negative = show earlier). */
  delay: number;
  /** Font-size scale tier. */
  size: SubSize;
  /** Whether the player is in fullscreen. */
  isFullscreen: boolean;
}

export function SubtitleOverlay({
  videoRef,
  cues,
  delay,
  size,
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

  return (
    <div className={`dc-sub-overlay ${isFullscreen ? "is-fs" : ""}`}>
      <div className="dc-sub-zone dc-sub-zone--top">
        {top.map((cue) => (
          <CueLine key={cue.id} cue={cue} size={size} />
        ))}
      </div>
      <div className="dc-sub-zone dc-sub-zone--bottom">
        {bottom.map((cue) => (
          <CueLine key={cue.id} cue={cue} size={size} />
        ))}
      </div>
    </div>
  );
}

function CueLine({ cue, size }: { cue: SubCue; size: SubSize }) {
  const styles = cue.styles;
  return (
    <span
      className={`dc-sub-cue dc-sub-cue--${size}`}
      data-bold={styles?.bold ?? false}
      data-italic={styles?.italic ?? false}
      data-underline={styles?.underline ?? false}
      data-align={styles?.align ?? "center"}
      style={{
        color: styles?.color || "#ffffff",
        fontFamily: styles?.fontFamily || undefined,
      }}
    >
      {cue.text}
    </span>
  );
}
