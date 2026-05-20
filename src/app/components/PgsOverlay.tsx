/**
 * PgsOverlay — canvas overlay for Blu-ray PGS (S_HDMV/PGS) subtitles.
 *
 * Paints pre-decoded RGBA bitmaps from `pgs-renderer.ts` at the position the
 * PCS specified, scaled from the PGS authoring resolution (almost always
 * 1920×1080) into the player's current pixel box. Synced to `currentTime`
 * via rAF, identical to SubtitleOverlay's loop — but the cue payload is
 * pixels, not text.
 *
 * User typography settings deliberately do not apply: PGS bitmaps carry their
 * own typesetting (Blu-ray anime almost always has fansub-quality signs and
 * styled credits). If the user wants control, they should pick the embedded
 * ASS track instead.
 */

import { useEffect, useRef } from "react";
import type { PgsComposition } from "../services/pgs-renderer";

interface Props {
  /** Reference to the <video> element we should sync against. */
  videoRef: React.RefObject<HTMLVideoElement>;
  /** Sorted compositions for the active PGS track. */
  compositions: PgsComposition[];
  /** Delay in seconds (positive = show later). Same convention as
   *  SubtitleOverlay so the same control on the HUD applies to both. */
  delay: number;
}

export function PgsOverlay({ videoRef, compositions, delay }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Cache the ImageData per composition-object so we don't allocate a new
  // typed array on every frame. Cleared when the compositions array changes.
  const imageDataCache = useRef<WeakMap<Uint8ClampedArray, ImageData>>(
    new WeakMap(),
  );
  const lastDrawnIndex = useRef<number>(-2);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    imageDataCache.current = new WeakMap();
    lastDrawnIndex.current = -2;
  }, [compositions]);

  useEffect(() => {
    function tick() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const t = video.currentTime - delay;
      const idx = findActiveCompositionIndex(compositions, t);

      if (idx === lastDrawnIndex.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastDrawnIndex.current = idx;

      const ctx = canvas.getContext("2d");
      if (!ctx) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const comp = idx >= 0 ? compositions[idx] : null;
      const targetWidth = video.clientWidth;
      const targetHeight = video.clientHeight;

      // Match the canvas backing store to the player frame at devicePixelRatio
      // so the bitmaps stay crisp on high-DPI screens. Only resize when the
      // box changes — resizing zeroes the canvas, which causes a flicker.
      const dpr = window.devicePixelRatio || 1;
      const cssW = Math.max(1, Math.floor(targetWidth));
      const cssH = Math.max(1, Math.floor(targetHeight));
      const bw = Math.max(1, Math.floor(cssW * dpr));
      const bh = Math.max(1, Math.floor(cssH * dpr));
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      canvas.style.width = `${cssW}px`;
      canvas.style.height = `${cssH}px`;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      if (!comp) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      // Scale factor from PGS authoring coordinates to the CSS box, then up
      // again by dpr for the backing store.
      const sx = (cssW / comp.videoWidth) * dpr;
      const sy = (cssH / comp.videoHeight) * dpr;

      for (const obj of comp.objects) {
        let img = imageDataCache.current.get(obj.rgba);
        if (!img) {
          // Cast: lib.dom narrowed `ImageData`'s ctor to
          // `Uint8ClampedArray<ArrayBuffer>` to exclude SharedArrayBuffer.
          // We allocate the buffer ourselves in pgs-renderer.ts with
          // `new Uint8ClampedArray(...)`, so the runtime backing IS a plain
          // ArrayBuffer; the cast is just bridging the generic gap.
          img = new ImageData(
            obj.rgba as Uint8ClampedArray<ArrayBuffer>,
            obj.width,
            obj.height,
          );
          imageDataCache.current.set(obj.rgba, img);
        }
        // `putImageData` ignores transforms, so we draw via a temporary
        // canvas of the object's native size and then `drawImage` it
        // scaled. The detour is cheap (one putImageData + one drawImage)
        // and avoids per-pixel software scaling.
        const scratch =
          scratchCanvas.width === obj.width &&
          scratchCanvas.height === obj.height
            ? scratchCanvas
            : resizeScratch(obj.width, obj.height);
        const sctx = scratch.getContext("2d");
        if (!sctx) continue;
        sctx.clearRect(0, 0, scratch.width, scratch.height);
        sctx.putImageData(img, 0, 0);
        ctx.drawImage(
          scratch,
          0,
          0,
          obj.width,
          obj.height,
          Math.round(obj.x * sx),
          Math.round(obj.y * sy),
          Math.round(obj.width * sx),
          Math.round(obj.height * sy),
        );
      }

      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [compositions, delay, videoRef]);

  if (compositions.length === 0) return null;

  return (
    <canvas
      ref={canvasRef}
      className="dc-pgs-overlay"
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        margin: "auto",
        pointerEvents: "none",
        zIndex: 20,
      }}
    />
  );
}

// Module-scoped scratch canvas for the per-frame detour. Shared across all
// overlay instances; PGS rendering is single-threaded on the main loop so
// there's no risk of two cues writing to it simultaneously.
const scratchCanvas: HTMLCanvasElement =
  typeof document !== "undefined"
    ? document.createElement("canvas")
    : ({ width: 0, height: 0, getContext: () => null } as unknown as HTMLCanvasElement);

function resizeScratch(width: number, height: number): HTMLCanvasElement {
  scratchCanvas.width = width;
  scratchCanvas.height = height;
  return scratchCanvas;
}

function findActiveCompositionIndex(
  compositions: PgsComposition[],
  t: number,
): number {
  // Linear scan with early break — PGS tracks hold a few hundred entries at
  // most, so the constant is fine and avoids the boilerplate of maintaining
  // a separate sorted-end-times index.
  for (let i = 0; i < compositions.length; i++) {
    const c = compositions[i];
    if (c.start > t) return -1;
    if (c.end > t) return i;
  }
  return -1;
}
