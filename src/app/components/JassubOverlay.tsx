/**
 * JassubOverlay — libass-WASM (JASSUB) rendering surface for ASS/SSA cues.
 *
 * Phase 2 / P2.1: lifts ASS rendering from the plain-text CSS overlay into a
 * real libass instance so fansub typesetting (karaoke, position overrides,
 * fades, alt fonts) renders the way Aegisub intended.
 *
 * Lifecycle:
 *   1. On mount, lazy-import the `jassub` ESM module — keeps the ~500 KB
 *      WASM blob out of the lobby/library bundles so non-player surfaces stay
 *      light.
 *   2. Construct a JASSUB instance bound to the parent's <video> element and
 *      a freshly created canvas sibling. JASSUB attaches a ResizeObserver so
 *      the canvas tracks the video's intrinsic size automatically.
 *   3. On `subContent` change, reload the script in-place via
 *      `setTrackByUrl`/`setTrack` so switching languages doesn't tear down
 *      the worker.
 *   4. On unmount, destroy the instance to free the worker + WASM heap.
 *
 * Failure mode: if JASSUB throws (CSP, missing wasm asset, libass parse
 * error) we log + render nothing. DrivePlayer's plain-text SubtitleOverlay
 * remains the safety net by virtue of staying mounted — to enable that
 * fallback, swap `useJassub` to false in the parent when an error fires.
 */

import { useEffect, useRef, type RefObject } from "react";
// Vite emits these as separate asset URLs that the worker can fetch at
// runtime from the chrome-extension://<id>/ origin. Importing this way
// avoids hard-coding paths and keeps the worker/wasm versioned alongside
// the `jassub` npm package.
import workerUrl from "jassub/dist/wasm/jassub-worker.js?url";
import wasmUrl from "jassub/dist/wasm/jassub-worker.wasm?url";
import modernWasmUrl from "jassub/dist/wasm/jassub-worker-modern.wasm?url";
import defaultFontUrl from "jassub/dist/default.woff2?url";
import { BUNDLED_ASS_FONT_FAMILY } from "../services/subtitles";
import "./JassubOverlay.scss";

interface Props {
  videoRef: RefObject<HTMLVideoElement>;
  /** Raw .ass/.ssa source, complete with [Script Info] + [V4+ Styles] +
   *  [Events] sections. */
  subContent: string;
  /** Seconds to shift the script relative to the video clock. Positive = subs
   *  appear later. Threaded through to libass via JASSUB's `timeOffset`. */
  timeOffset?: number;
  /** Fires once the JASSUB worker has bootstrapped and accepted the first
   *  script. Until this signals, the parent should keep the plain-text CSS
   *  overlay visible so the user always sees *some* subtitles. */
  onReady?: () => void;
  /** Fires on any init / load failure (WASM not loadable under the extension
   *  CSP, missing assets, libass parse error, etc.). The parent should keep
   *  the CSS overlay active and stop expecting libass output for this
   *  track. */
  onError?: (err: unknown) => void;
}

// Module-level cache so React StrictMode's double-invoke doesn't create
// duplicate instances during dev.
type JassubModule = typeof import("jassub");
let jassubModulePromise: Promise<JassubModule> | null = null;
function loadJassub(): Promise<JassubModule> {
  if (!jassubModulePromise) {
    jassubModulePromise = import("jassub");
  }
  return jassubModulePromise;
}

export function JassubOverlay({
  videoRef,
  subContent,
  timeOffset = 0,
  onReady,
  onError,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The JASSUB instance. Typed as `any` because the JASSUB constructor's
  // overloaded option-shape doesn't narrow nicely under the lazy import.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const instanceRef = useRef<any>(null);

  // Stash callbacks in refs so the mount effect can stay locked to [videoRef]
  // — otherwise every parent render that produces fresh callback identities
  // would tear down and reconstruct the libass worker, which is expensive
  // and would defeat the whole "init once" design.
  const onReadyRef = useRef(onReady);
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onReadyRef.current = onReady;
    onErrorRef.current = onError;
  });

  // Mount / unmount.
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let cancelled = false;

    void (async () => {
      try {
        const mod = await loadJassub();
        if (cancelled) return;
        const JASSUB = mod.default;
        const inst = new JASSUB({
          video,
          canvas,
          subContent,
          workerUrl,
          wasmUrl,
          modernWasmUrl,
          // Single registered family. `stripAssFontReferences` rewrites every
          // Style.Fontname column to BUNDLED_ASS_FONT_FAMILY so libass
          // resolves on the first lookup — no OS query, no Google Fonts.
          availableFonts: { [BUNDLED_ASS_FONT_FAMILY]: defaultFontUrl },
          defaultFont: BUNDLED_ASS_FONT_FAMILY,
          // Skip the local-font query entirely. The user opted out of OS font
          // matching — we still honor every other ASS style (positioning,
          // color, italic, bold, karaoke, fades), but render every glyph in
          // the bundled fallback face.
          queryFonts: false,
          timeOffset,
        });
        instanceRef.current = inst;
        // Worker init is async — `new JASSUB(...)` returns synchronously but
        // the worker can still fail to load WASM / boot. Awaiting `ready`
        // surfaces those failures so we can fire onError instead of pretending
        // libass is rendering when it isn't.
        if (inst.ready && typeof inst.ready.then === "function") {
          await inst.ready;
        }
        if (cancelled) return;
        onReadyRef.current?.();
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[JASSUB] failed to initialise:", err);
        if (!cancelled) onErrorRef.current?.(err);
      }
    })();

    return () => {
      cancelled = true;
      const inst = instanceRef.current;
      instanceRef.current = null;
      if (inst) {
        try {
          void inst.destroy();
        } catch {
          // best-effort
        }
      }
    };
    // We intentionally exclude `subContent` and `timeOffset` from deps so the
    // worker isn't rebuilt on every script change — those are pushed via the
    // separate effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoRef]);

  // Script reload — push new ASS source into the existing worker.
  //
  // While an embedded MKV is still streaming, `subContent` grows as each
  // cluster contributes new Dialogue rows. Calling setTrack synchronously on
  // every change would re-parse the script on the libass worker tens of times
  // per second and produce a visible blink. Debouncing collapses runs of
  // updates into one setTrack call per quiet window — the user sees the
  // latest cues within ~250 ms of the last cluster arriving, with no
  // perceptible churn.
  useEffect(() => {
    const inst = instanceRef.current;
    if (!inst) return;
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          await inst.ready;
          if (cancelled) return;
          await inst.renderer.setTrack(subContent);
        } catch (err) {
          if (!cancelled) {
            // eslint-disable-next-line no-console
            console.warn("[JASSUB] setTrack failed:", err);
            onErrorRef.current?.(err);
          }
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [subContent]);

  // Time offset push — cheap, just sets a property; no worker rebuild.
  useEffect(() => {
    const inst = instanceRef.current;
    if (!inst) return;
    try {
      inst.timeOffset = timeOffset;
    } catch {
      // ignore
    }
  }, [timeOffset]);

  return (
    <canvas
      ref={canvasRef}
      className="ny-jassub"
      aria-hidden
      // Width/height start at zero; JASSUB resizes the backing store the
      // moment it attaches a ResizeObserver to the <video>.
    />
  );
}
