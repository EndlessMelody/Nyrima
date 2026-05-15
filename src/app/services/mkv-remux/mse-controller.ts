/**
 * MSE Controller — orchestrates the MKV→fMP4 remux pipeline.
 *
 * Flow:
 *   1. Fetch MKV header via Range request (or accept pre-fetched buffer)
 *   2. Parse track info → build fMP4 init segment
 *   3. Create MediaSource, attach SourceBuffer, append init segment
 *   4. Stream remaining data via a SINGLE fetch (ReadableStream)
 *   5. Parse EBML Clusters from accumulated stream data, remux to fMP4, append
 *   6. Repeat until EOF
 *
 * API call budget: 1 header Range request + 1 streaming fetch = 2 total.
 * (If a pre-fetched header is provided, only 1 streaming fetch.)
 */

import { readElement, iterateElements, MKV_ID } from "../ebml";
import { parseMkvMediaInfo, extractClusterSamples } from "./demuxer";
import { generateInitSegment, generateMediaSegment } from "./mp4-generator";
import { buildMediaUrl } from "../drive-api";
import { authedFetch } from "../auth";
import {
  useRateLimitStore,
  isCoolingDown,
} from "../drive/rate-limit-store";
import { markPlayback } from "../playback-telemetry";
import type { MkvMediaInfo } from "./types";

const HEADER_FETCH_SIZE = 4 * 1024 * 1024; // 4 MB — enough for header + several clusters
const STREAM_PROCESS_SIZE = 2 * 1024 * 1024; // accumulate 2 MB from stream before processing
const BUFFER_AHEAD_SEC = 30;                // how far ahead to keep buffered
const BUFFER_BEHIND_SEC = 60;               // how far behind to keep

// Stop reading the stream entirely when the video has been paused this long.
// We don't tear down the connection — we just stop pulling bytes. Drive will
// close the conn from its side after a while, which is fine; the next play
// will reopen from the current offset. This keeps a paused tab from chewing
// through quota for a video the user may never resume.
const PAUSE_IDLE_MS = 60_000;

export class MkvMseController {
  private mediaSource: MediaSource | null = null;
  private sourceBuffer: SourceBuffer | null = null;
  private objectUrl: string | null = null;
  private info: MkvMediaInfo | null = null;
  private fileId = "";
  private fileSize = 0;
  private fetchOffset = 0;
  private seqNum = 0;
  private destroyed = false;
  private fetching = false;
  private appendQueue: Uint8Array[] = [];
  private leftoverBuf: Uint8Array | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private initDone = false;
  private streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  /** Aborts the active fetch when destroy() runs or the user navigates away. */
  private abortController: AbortController | null = null;
  /** Set when document.visibilityState becomes "hidden" (or video paused too
   *  long); the streaming loop suspends until this clears. */
  private suspended = false;
  /** Flipped to true by the pause-idle timer; cleared by `play`. */
  private pausedTooLong = false;
  /** Cleanup functions registered while running; called from destroy(). */
  private cleanups: Array<() => void> = [];

  // Callbacks for the UI
  onReady?: (url: string, durationMs: number) => void;
  onError?: (err: Error) => void;

  /**
   * @param preloaded Optional pre-fetched header buffer to avoid a redundant
   *   Range request (e.g. when subtitle extraction already fetched it).
   */
  async start(
    fileId: string,
    videoElement: HTMLVideoElement,
    preloaded?: { buf: Uint8Array; fileSize: number },
  ): Promise<void> {
    this.fileId = fileId;
    this.videoElement = videoElement;
    this.destroyed = false;
    this.abortController = new AbortController();
    this.installBackpressureHooks(videoElement);

    try {
      let buf: Uint8Array;

      if (preloaded) {
        buf = preloaded.buf;
        this.fileSize = preloaded.fileSize;
        // eslint-disable-next-line no-console
        console.info(
          `[mse] using preloaded header buf=${buf.length} size=${this.fileSize}`,
        );
      } else {
        // 1. Fetch header region (also contains the first clusters)
        // eslint-disable-next-line no-console
        console.info(
          `[mse] fetching header ${HEADER_FETCH_SIZE} bytes for ${fileId}`,
        );
        markPlayback("media:first-range:start");
        const result = await this.fetchRange(0, HEADER_FETCH_SIZE - 1);
        markPlayback("media:first-range:end");
        if (this.destroyed) return;
        buf = result.buf;
        this.fileSize = result.total;
        // eslint-disable-next-line no-console
        console.info(`[mse] header arrived; fileSize=${this.fileSize}`);
      }

      // 2. Parse MKV header
      this.info = parseMkvMediaInfo(buf);

      // 3. Build init segment
      const { data: initSeg, codecString } = generateInitSegment(
        this.info.video,
        this.info.audio,
      );

      // Slice out the cluster portion of the header buffer so we can
      // process it immediately after the init segment is appended.
      // This avoids a redundant fetch of data we already have.
      const clusterData = this.info.firstClusterOffset < buf.length
        ? buf.slice(this.info.firstClusterOffset)
        : null;

      // Streaming fetch will continue from the end of what we already have.
      this.fetchOffset = buf.length;

      // 4. Create MediaSource
      markPlayback("remux:start");
      this.mediaSource = new MediaSource();
      this.objectUrl = URL.createObjectURL(this.mediaSource);

      this.mediaSource.addEventListener("sourceopen", () => {
        if (this.destroyed || !this.mediaSource || !this.info) return;

        try {
          const mimeType = `video/mp4; codecs="${codecString}"`;
          // eslint-disable-next-line no-console
          console.info(`[mse] checking codec support: ${mimeType}`);
          if (!MediaSource.isTypeSupported(mimeType)) {
            // eslint-disable-next-line no-console
            console.error(`[mse] codec UNSUPPORTED: ${codecString}`);
            this.onError?.(
              new Error(
                `This file's codec (${codecString}) isn't supported by your browser. ` +
                `Common causes: 10-bit H.264 (Hi10P), HEVC/H.265, or AV1. ` +
                `For HEVC on Windows, install "HEVC Video Extensions" from the Microsoft Store.`,
              ),
            );
            return;
          }
          this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);
          this.sourceBuffer.mode = "segments";

          this.sourceBuffer.addEventListener("updateend", () => {
            this.drainQueue();
          });

          this.sourceBuffer.addEventListener("error", () => {
            this.onError?.(new Error("SourceBuffer error"));
          });

          // Append init segment
          this.sourceBuffer.appendBuffer(initSeg.buffer.slice(initSeg.byteOffset, initSeg.byteOffset + initSeg.byteLength) as ArrayBuffer);
          this.initDone = true;

          // Process clusters already in the header buffer — this gets the
          // first frame on screen without an extra network round-trip.
          if (clusterData && clusterData.length > 0) {
            this.processChunk(clusterData);
          }

          // Continue with a single streaming fetch for the rest of the file.
          this.progressiveStream();
        } catch (e) {
          this.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
      });

      videoElement.src = this.objectUrl;
      this.onReady?.(this.objectUrl, this.info.durationMs);
    } catch (e) {
      this.onError?.(e instanceof Error ? e : new Error(String(e)));
    }
  }

  destroy(): void {
    this.destroyed = true;
    // Cancel the in-flight Drive stream so we don't keep pulling bytes for
    // a video the user has navigated away from.
    if (this.abortController) {
      try {
        this.abortController.abort();
      } catch {
        // ignore
      }
      this.abortController = null;
    }
    // Cancel the streaming reader if active
    if (this.streamReader) {
      this.streamReader.cancel().catch(() => {/* ignore */});
      this.streamReader = null;
    }
    for (const fn of this.cleanups) {
      try {
        fn();
      } catch {
        // ignore
      }
    }
    this.cleanups = [];
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    if (
      this.mediaSource &&
      this.mediaSource.readyState === "open"
    ) {
      try {
        this.mediaSource.endOfStream();
      } catch {
        // ignore
      }
    }
    this.mediaSource = null;
    this.sourceBuffer = null;
    this.videoElement = null;
    this.appendQueue = [];
    this.leftoverBuf = null;
  }

  /**
   * Wire up the conditions that should pause the streaming loop:
   *   - tab hidden (document.visibilityState)
   *   - video paused continuously for PAUSE_IDLE_MS
   *   - Drive is in a global cooldown
   * The loop checks `this.suspended` between chunks; it does not tear down
   * the connection itself, so a brief blur won't drop the underlying TCP
   * stream and force a reconnect.
   */
  private installBackpressureHooks(videoEl: HTMLVideoElement): void {
    const refresh = () => this.refreshSuspendState(videoEl);

    const onVis = () => refresh();
    document.addEventListener("visibilitychange", onVis);
    this.cleanups.push(() =>
      document.removeEventListener("visibilitychange", onVis),
    );

    let pauseTimer: number | null = null;
    const onPause = () => {
      if (pauseTimer !== null) window.clearTimeout(pauseTimer);
      pauseTimer = window.setTimeout(() => {
        pauseTimer = null;
        this.pausedTooLong = true;
        refresh();
      }, PAUSE_IDLE_MS);
    };
    const onPlay = () => {
      if (pauseTimer !== null) {
        window.clearTimeout(pauseTimer);
        pauseTimer = null;
      }
      this.pausedTooLong = false;
      refresh();
    };
    videoEl.addEventListener("pause", onPause);
    videoEl.addEventListener("play", onPlay);
    this.cleanups.push(() => {
      videoEl.removeEventListener("pause", onPause);
      videoEl.removeEventListener("play", onPlay);
      if (pauseTimer !== null) window.clearTimeout(pauseTimer);
    });

    const unsubscribeCooldown = useRateLimitStore.subscribe((s, prev) => {
      if (s.isCooling !== prev.isCooling) refresh();
    });
    this.cleanups.push(unsubscribeCooldown);

    refresh();
  }

  private refreshSuspendState(_videoEl: HTMLVideoElement): void {
    if (this.destroyed) return;
    const tabHidden =
      typeof document !== "undefined" && document.visibilityState === "hidden";
    const cooling = isCoolingDown();
    this.suspended = tabHidden || cooling || this.pausedTooLong;
  }

  /**
   * Loop-helper: wait until the suspend conditions clear. Returns when the
   * controller is destroyed so the streaming loop can break out cleanly.
   */
  private async waitWhileSuspended(): Promise<void> {
    while (!this.destroyed && this.suspended) {
      await sleep(500);
    }
  }

  // -------------------------------------------------------------------------
  // Streaming fetch — ONE request for the entire remaining file
  // -------------------------------------------------------------------------

  /**
   * Uses a single HTTP request with an open-ended Range header and reads the
   * response body as a ReadableStream. This replaces hundreds of per-chunk
   * Range requests, reducing Drive API calls from ~500 to 1.
   *
   * Retries: handled by the central DriveRequestQueue (see authedFetch).
   * The local 3-retry loop is gone — it duplicated work the queue already
   * does and didn't honor Retry-After.
   */
  private async progressiveStream(): Promise<void> {
    if (this.fetching || this.destroyed) return;
    if (this.fetchOffset >= this.fileSize) {
      this.finalizeStream();
      return;
    }
    this.fetching = true;

    try {
      const url = buildMediaUrl(this.fileId);
      const res = await authedFetch(
        url,
        {
          headers: { Range: `bytes=${this.fetchOffset}-` },
          signal: this.abortController?.signal,
        },
        {
          kind: "media-stream",
          priority: "critical",
          signal: this.abortController?.signal,
        },
      );
      if (this.destroyed) return;

      const reader = res.body?.getReader();
      if (!reader) {
        // Fallback: ReadableStream not available — read the tail as a single
        // ArrayBuffer. This is the rare path (older WebView only).
        const ab = await res.arrayBuffer();
        if (this.destroyed) return;
        const data = new Uint8Array(ab);
        const full = this.leftoverBuf
          ? concatBuffers(this.leftoverBuf, data)
          : data;
        this.leftoverBuf = null;
        this.processChunk(full);
        this.fetchOffset = this.fileSize;
      } else {
        this.streamReader = reader;
        let accumulated: Uint8Array | null = this.leftoverBuf;
        this.leftoverBuf = null;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (this.destroyed || this.mediaSource?.readyState !== "open") break;

          // Back-pressure: pause when tab hidden, video idle, or cooldown.
          // We stop pulling from the stream but keep the connection alive;
          // Drive will close it if it idles too long, which is acceptable.
          if (this.suspended) {
            await this.waitWhileSuspended();
            if (this.destroyed) break;
          }

          const { done, value } = await reader.read();
          if (done) break;

          accumulated = accumulated
            ? concatBuffers(accumulated, value)
            : value;

          if (accumulated.length >= STREAM_PROCESS_SIZE) {
            // Throttle if we're far enough ahead — keeps SourceBuffer small.
            await this.waitUntilBufferNeeded();
            if (this.destroyed) break;

            this.processChunk(accumulated);
            accumulated = this.leftoverBuf;
            this.leftoverBuf = null;
            this.evictOldBuffers();
          }
        }

        if (accumulated && accumulated.length > 0 && !this.destroyed) {
          this.processChunk(accumulated);
        }

        this.streamReader = null;
        try {
          reader.releaseLock();
        } catch {
          // ignore
        }
        this.fetchOffset = this.fileSize;
      }
    } catch (e) {
      this.streamReader = null;
      // Abort-on-destroy raises an AbortError that we swallow silently;
      // anything else bubbles up to the player as a fatal error. Retry
      // policy (429/5xx/network) lives in DriveRequestQueue now, so by
      // the time we land here the queue has already exhausted retries.
      const isAbort =
        e instanceof DOMException && e.name === "AbortError";
      if (!this.destroyed && !isAbort) {
        this.onError?.(e instanceof Error ? e : new Error(String(e)));
      }
      return;
    } finally {
      this.fetching = false;
    }

    this.finalizeStream();
  }

  /** Wait until the buffer-ahead threshold allows more data to be processed. */
  private async waitUntilBufferNeeded(): Promise<void> {
    while (this.videoElement && this.sourceBuffer && !this.destroyed) {
      const buffered = this.sourceBuffer.buffered;
      if (buffered.length > 0) {
        const bufferedEnd = buffered.end(buffered.length - 1);
        if (bufferedEnd - this.videoElement.currentTime > BUFFER_AHEAD_SEC) {
          await sleep(500);
          this.evictOldBuffers();
          continue;
        }
      }
      break;
    }
  }

  private finalizeStream(): void {
    if (
      !this.destroyed &&
      this.mediaSource?.readyState === "open"
    ) {
      // Wait for pending appends, then signal end
      this.waitForUpdateEnd().then(() => {
        if (this.mediaSource?.readyState === "open") {
          try { this.mediaSource.endOfStream(); } catch { /* ignore */ }
        }
      });
    }
  }

  private processChunk(data: Uint8Array): void {
    if (!this.info) return;

    let offset = 0;
    while (offset < data.length) {
      // Skip zero-padding between elements.
      if (data[offset] === 0x00) { offset++; continue; }

      const el = readElement(data, offset);
      if (!el) {
        // Can't parse header — likely truncated at chunk boundary.
        // Save remaining bytes as leftover for the next chunk.
        if (offset < data.length) this.leftoverBuf = data.slice(offset);
        return;
      }

      if (el.id === MKV_ID.Cluster) {
        // Parse available children even if the Cluster extends beyond
        // the buffer. extractClusterSamples uses iterateElements which
        // stops gracefully at the buffer boundary.
        try {
          const samples = extractClusterSamples(data, el, this.info);
          if (samples.length > 0) {
            this.seqNum++;
            const segment = generateMediaSegment(
              samples,
              this.seqNum,
              this.info.video,
              this.info.audio,
            );
            // Mark the moment the first remuxed media segment is ready to
            // append. Tells us how long parse+remux took versus network.
            if (this.seqNum === 1) markPlayback("remux:first-segment-ready");
            this.enqueueAppend(segment);
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("Cluster parse error (skipping):", e);
        }

        // Advance past this Cluster (or to end of buffer if it extends beyond)
        const clusterEnd = el.elementOffset + el.elementLength;
        offset = Math.min(clusterEnd, data.length);
      } else {
        // Non-Cluster element (Cues, Tags, SeekHead, etc.)
        if (el.dataOffset + el.dataLength > data.length) {
          // Incomplete non-Cluster element — save as leftover.
          this.leftoverBuf = data.slice(offset);
          return;
        }
        offset += el.elementLength;
      }
    }
  }

  // -------------------------------------------------------------------------
  // SourceBuffer append queue
  // -------------------------------------------------------------------------

  private enqueueAppend(data: Uint8Array): void {
    this.appendQueue.push(data);
    this.drainQueue();
  }

  private drainQueue(): void {
    if (
      !this.sourceBuffer ||
      this.sourceBuffer.updating ||
      this.appendQueue.length === 0
    ) {
      return;
    }
    const next = this.appendQueue.shift()!;
    try {
      this.sourceBuffer.appendBuffer(next.buffer.slice(next.byteOffset, next.byteOffset + next.byteLength) as ArrayBuffer);
    } catch (e) {
      // QuotaExceededError — evict and retry
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        this.evictOldBuffers();
        this.appendQueue.unshift(next);
        setTimeout(() => this.drainQueue(), 500);
      } else {
        this.onError?.(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  private evictOldBuffers(): void {
    if (!this.sourceBuffer || !this.videoElement) return;
    const ct = this.videoElement.currentTime;
    const removeEnd = ct - BUFFER_BEHIND_SEC;
    if (removeEnd <= 0) return;
    const buffered = this.sourceBuffer.buffered;
    if (buffered.length > 0 && buffered.start(0) < removeEnd) {
      if (!this.sourceBuffer.updating) {
        try {
          this.sourceBuffer.remove(buffered.start(0), removeEnd);
        } catch {
          // ignore
        }
      }
    }
  }

  private waitForUpdateEnd(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.sourceBuffer || !this.sourceBuffer.updating) {
        resolve();
        return;
      }
      const handler = () => {
        this.sourceBuffer?.removeEventListener("updateend", handler);
        resolve();
      };
      this.sourceBuffer.addEventListener("updateend", handler);
    });
  }

  // -------------------------------------------------------------------------
  // Network — used only for the initial header fetch
  // -------------------------------------------------------------------------

  private async fetchRange(
    start: number,
    end: number,
  ): Promise<{ buf: Uint8Array; total: number }> {
    const url = buildMediaUrl(this.fileId);
    // Retries (429/5xx/network) and backoff live in DriveRequestQueue now.
    // Header fetch is "critical" because nothing else can start until it
    // returns — the MediaSource has no init segment without it.
    const res = await authedFetch(
      url,
      {
        headers: { Range: `bytes=${start}-${end}` },
        signal: this.abortController?.signal,
      },
      {
        kind: "media-range",
        priority: "critical",
        signal: this.abortController?.signal,
      },
    );

    const contentRange = res.headers.get("content-range");
    let total = end + 1;
    if (contentRange) {
      const m = contentRange.match(/\/(\d+)/);
      if (m) total = Number(m[1]);
    }

    const ab = await res.arrayBuffer();
    return { buf: new Uint8Array(ab), total };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function concatBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
