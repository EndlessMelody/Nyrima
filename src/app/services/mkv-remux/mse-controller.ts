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
import type { MkvMediaInfo } from "./types";

const HEADER_FETCH_SIZE = 4 * 1024 * 1024; // 4 MB — enough for header + several clusters
const STREAM_PROCESS_SIZE = 2 * 1024 * 1024; // accumulate 2 MB from stream before processing
const BUFFER_AHEAD_SEC = 30;                // how far ahead to keep buffered
const BUFFER_BEHIND_SEC = 60;               // how far behind to keep

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

    try {
      let buf: Uint8Array;

      if (preloaded) {
        buf = preloaded.buf;
        this.fileSize = preloaded.fileSize;
      } else {
        // 1. Fetch header region (also contains the first clusters)
        const result = await this.fetchRange(0, HEADER_FETCH_SIZE - 1);
        if (this.destroyed) return;
        buf = result.buf;
        this.fileSize = result.total;
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
      this.mediaSource = new MediaSource();
      this.objectUrl = URL.createObjectURL(this.mediaSource);

      this.mediaSource.addEventListener("sourceopen", () => {
        if (this.destroyed || !this.mediaSource || !this.info) return;

        try {
          const mimeType = `video/mp4; codecs="${codecString}"`;
          if (!MediaSource.isTypeSupported(mimeType)) {
            this.onError?.(
              new Error(
                `Browser does not support codec "${codecString}". ` +
                `For HEVC, install HEVC Video Extensions from the Microsoft Store.`,
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
    // Cancel the streaming reader if active
    if (this.streamReader) {
      this.streamReader.cancel().catch(() => {/* ignore */});
      this.streamReader = null;
    }
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

  // -------------------------------------------------------------------------
  // Streaming fetch — ONE request for the entire remaining file
  // -------------------------------------------------------------------------

  /**
   * Uses a single HTTP request with an open-ended Range header and reads the
   * response body as a ReadableStream. This replaces hundreds of per-chunk
   * Range requests, reducing Drive API calls from ~500 to 1.
   */
  private async progressiveStream(): Promise<void> {
    if (this.fetching || this.destroyed) return;
    if (this.fetchOffset >= this.fileSize) {
      this.finalizeStream();
      return;
    }
    this.fetching = true;

    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const url = buildMediaUrl(this.fileId);
        const res = await authedFetch(url, {
          headers: { Range: `bytes=${this.fetchOffset}-` },
        });
        if (this.destroyed) return;

        const reader = res.body?.getReader();
        if (!reader) {
          // Fallback: ReadableStream not available — read as ArrayBuffer
          const ab = await res.arrayBuffer();
          if (this.destroyed) return;
          const data = new Uint8Array(ab);
          const full = this.leftoverBuf
            ? concatBuffers(this.leftoverBuf, data)
            : data;
          this.leftoverBuf = null;
          this.processChunk(full);
          this.fetchOffset = this.fileSize;
          break;
        }

        this.streamReader = reader;
        let accumulated: Uint8Array | null = this.leftoverBuf;
        this.leftoverBuf = null;

        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (this.destroyed || this.mediaSource?.readyState !== "open") break;

          const { done, value } = await reader.read();
          if (done) break;

          // Accumulate stream chunks
          accumulated = accumulated
            ? concatBuffers(accumulated, value)
            : value;

          // Process when we have enough data accumulated
          if (accumulated.length >= STREAM_PROCESS_SIZE) {
            // Throttle if we're far enough ahead to avoid SourceBuffer overflow
            await this.waitUntilBufferNeeded();
            if (this.destroyed) break;

            this.processChunk(accumulated);
            accumulated = this.leftoverBuf;
            this.leftoverBuf = null;
            this.evictOldBuffers();
          }
        }

        // Process remaining accumulated data
        if (accumulated && accumulated.length > 0 && !this.destroyed) {
          this.processChunk(accumulated);
        }

        this.streamReader = null;
        reader.releaseLock();
        this.fetchOffset = this.fileSize;
        break; // success — exit retry loop

      } catch (e) {
        this.streamReader = null;
        const isRetryable =
          e instanceof Error &&
          (e.message.includes("403") ||
            e.message.includes("rate") ||
            e.message.includes("429"));
        if (isRetryable && attempt < MAX_RETRIES) {
          // eslint-disable-next-line no-console
          console.warn(`Stream retry ${attempt + 1}/${MAX_RETRIES}:`, (e as Error).message);
          await sleep(1000 * Math.pow(2, attempt));
          continue;
        }
        if (!this.destroyed) {
          this.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
        return;
      } finally {
        this.fetching = false;
      }
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
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await authedFetch(url, {
          headers: { Range: `bytes=${start}-${end}` },
        });

        const contentRange = res.headers.get("content-range");
        let total = end + 1;
        if (contentRange) {
          const m = contentRange.match(/\/(\d+)/);
          if (m) total = Number(m[1]);
        }

        const ab = await res.arrayBuffer();
        return { buf: new Uint8Array(ab), total };
      } catch (e) {
        // Retry on rate-limit / transient 403
        const isRetryable =
          e instanceof Error &&
          (e.message.includes("403") ||
            e.message.includes("rate") ||
            e.message.includes("429"));
        if (isRetryable && attempt < MAX_RETRIES) {
          // eslint-disable-next-line no-console
          console.warn(`fetchRange retry ${attempt + 1}/${MAX_RETRIES} after error:`, e.message);
          await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
          continue;
        }
        throw e;
      }
    }
    throw new Error("fetchRange: max retries exceeded");
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
