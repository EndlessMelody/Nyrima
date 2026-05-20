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
import {
  generateVideoInitSegment,
  generateAudioInitSegment,
  generateVideoMediaSegment,
  generateAudioMediaSegment,
  buildVideoMimeType,
  buildAudioMimeType,
} from "./mp4-generator";
import { buildMediaUrl } from "../drive-api";
import { authedFetch } from "../auth";
import {
  useRateLimitStore,
  isCoolingDown,
} from "../drive/rate-limit-store";
import { markPlayback } from "../playback-telemetry";
import { ExternalMkvAudioRenderer } from "./external-audio-renderer";
import type { MkvMediaInfo, AudioTrackInfo, DemuxedSample } from "./types";

const HEADER_FETCH_SIZE = 4 * 1024 * 1024; // 4 MB — enough for header + several clusters
const STREAM_PROCESS_SIZE = 2 * 1024 * 1024; // accumulate 2 MB from stream before processing
/** Soft target for how often `processChunk` should pause to let the browser
 *  paint / dispatch input / drain SourceBuffer queues. Anything north of
 *  one display frame at 60 Hz starts feeling like UI lag. */
const PROCESS_CHUNK_YIELD_MS = 16;
// Hard ceiling on the accumulated streaming buffer. HEVC files routinely
// produce clusters that don't terminate cleanly inside a 2 MB window; without
// this cap, accumulation can balloon until V8 refuses the next ArrayBuffer
// allocation ("Array buffer allocation failed"). When we cross the cap we
// abort the controller cleanly rather than OOM the tab.
const STREAM_MAX_ACCUMULATED = 64 * 1024 * 1024; // 64 MB
const BUFFER_AHEAD_SEC = 30;                // how far ahead to keep buffered
const BUFFER_BEHIND_SEC = 60;               // how far behind to keep
const BUFFER_RANGE_TOLERANCE_SEC = 0.25;    // bridge tiny fMP4 timestamp gaps
const THROTTLE_STALL_ESCAPE_MS = 2500;      // don't sleep if playback is stuck
const AUDIO_TIMELINE_NORMALIZE_THRESHOLD_MS = 500;
const THROTTLE_BYPASS_LOG_INTERVAL_MS = 5000;

// Stop reading the stream entirely when the video has been paused this long.
// We don't tear down the connection — we just stop pulling bytes. Drive will
// close the conn from its side after a while, which is fine; the next play
// will reopen from the current offset. This keeps a paused tab from chewing
// through quota for a video the user may never resume.
const PAUSE_IDLE_MS = 60_000;

export class MkvMseController {
  private mediaSource: MediaSource | null = null;
  /**
   * Split-buffer architecture. Each track lives in its own SourceBuffer so a
   * dub change can re-init the audio side (`audioSourceBuffer.changeType
   * + appendBuffer(initSeg)`) without touching the video buffer. That's
   * what makes a mid-flight audio swap feel VLC-instant — the picture never
   * blinks.
   */
  private videoSourceBuffer: SourceBuffer | null = null;
  private audioSourceBuffer: SourceBuffer | null = null;
  private objectUrl: string | null = null;
  private info: MkvMediaInfo | null = null;
  /** Cached header bytes so `switchAudio()` can re-parse the Tracks element
   *  for any TrackNumber without a second Range request. */
  private headerBuf: Uint8Array | null = null;
  private fileId = "";
  private fileSize = 0;
  private fetchOffset = 0;
  private videoSeq = 0;
  private audioSeq = 0;
  private destroyed = false;
  private fetching = false;
  private videoAppendQueue: Uint8Array[] = [];
  private audioAppendQueue: Uint8Array[] = [];
  /** Index of the last append we kicked off per buffer — let us label
   *  `error` events as init (appendCount=1) vs media (>1) so a buffer
   *  rejection is greppable instead of an opaque "SourceBuffer error". */
  private videoAppendCount = 0;
  private audioAppendCount = 0;
  private leftoverBuf: Uint8Array | null = null;
  /** Absolute byte-in-file offset of the first byte the *next* processChunk
   *  call will see. Used to compute per-cluster file offsets so the cluster
   *  index can drive a precise audio catch-up after a switch. */
  private nextChunkFileOffset = 0;
  /**
   * Sparse cluster index built incrementally as the main stream parses
   * clusters. Each entry is `(fileOffset, ptsMs)` of a cluster start. When
   * the user switches dubs we binary-search this to find the nearest
   * cluster ≤ `currentTime` and start a parallel range-fetch from there
   * so the new audio fills the buffer back to where the main stream is.
   */
  private clusterIndex: { fileOffset: number; ptsMs: number }[] = [];
  /** True while a switchAudio() is in flight; new appends to audioSB are
   *  prefixed with the freshly-emitted init segment. */
  private audioSwitching = false;
  /**
   * Filter applied by `processChunk` after a switch: when set, audio samples
   * for any other track are dropped (defence against `extractClusterSamples`
   * surfacing the old track via stale `info.audio` references). The catch-up
   * fetch uses this too.
   */
  private audioEmitFilter: number | null = null;
  /** The minimum PTS (ms) that an audio media segment must reach before we
   *  consider the audio caught up after a switch. Set to the playhead time
   *  at switch instant; cleared once audio buffered.end crosses it. */
  private audioCatchUpTargetMs = 0;
  /**
   * Some dual-audio MKVs expose the selected secondary track with an initial
   * media PTS of several seconds even though the video timeline starts at 0.
   * In split SourceBuffer mode that creates an audio hole at the beginning,
   * and Chrome will hang on rollback/seek targets inside the hole. For the
   * initial track only, shift emitted audio samples so the first audio media
   * fragment starts at 0. Mid-playback `switchAudio()` disables this because
   * catch-up ranges are already anchored to the current playhead.
   */
  private normalizeInitialAudioTimeline = true;
  private initialAudioTimelineAnchored = false;
  private initialAudioPtsOffsetMs = 0;
  /** Side range-fetch reader used by `switchAudio` to backfill audio between
   *  `currentTime` and the main stream's position. */
  private audioCatchUpAbort: AbortController | null = null;
  /** Optional VLC-style audio path: WebCodecs decodes FLAC outside MSE. */
  private externalAudio: ExternalMkvAudioRenderer | null = null;
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
  private lastThrottleBypassLogAt = 0;

  /** Set the first time onError fires; suppresses subsequent error fan-out. */
  private errored = false;

  // Callbacks for the UI
  onReady?: (url: string, durationMs: number) => void;
  /**
   * Wraps the user-supplied error callback to: (a) fire at most once per
   * controller lifecycle, (b) auto-destroy the controller so the broken
   * SourceBuffer can't keep emitting `updateend`/`error` cascades into a
   * caller that's already shown the error UI.
   */
  private _onError?: (err: Error) => void;
  get onError(): ((err: Error) => void) | undefined {
    return this._onError;
  }
  set onError(fn: ((err: Error) => void) | undefined) {
    this._onError = fn;
  }
  private fireError(err: Error): void {
    if (this.errored || this.destroyed) return;
    this.errored = true;
    try {
      this._onError?.(err);
    } finally {
      // Tear down the controller so any queued updateend / drainQueue work
      // turns into a no-op instead of throwing into a closed MediaSource.
      try {
        this.destroy();
      } catch {
        // ignore
      }
    }
  }
  /**
   * Called with every raw MKV chunk before remuxing. Used by the subtitle
   * extractor to piggyback on the same stream — zero extra API calls.
   */
  onRawChunk?: (data: Uint8Array) => void;
  /** Called once when the stream has been fully received and processed. */
  onStreamComplete?: () => void;

  /**
   * @param preloaded Optional pre-fetched header buffer to avoid a redundant
   *   Range request (e.g. when subtitle extraction already fetched it).
   * @param opts.audioTrackNumber MKV TrackNumber to bake into the init segment.
   *   When the user picks a different dub from the SettingsPopover, PlayerPage
   *   destroys the existing controller and starts a fresh one with this set —
   *   it's the cleanest way to switch dubs mid-playback because fMP4 init
   *   segments aren't re-writable in MSE without `changeType`, and we want
   *   the byte-stream demuxer to discard the unwanted track too.
   * @param opts.externalAudio When set to "webcodecs", FLAC audio is decoded
   *   outside MSE and clocked against the video element. This mirrors VLC's
   *   separate audio-output path and keeps the video SourceBuffer untouched.
   */
  async start(
    fileId: string,
    videoElement: HTMLVideoElement,
    preloaded?: { buf: Uint8Array; fileSize: number },
    opts?: { audioTrackNumber?: number; externalAudio?: "webcodecs" },
  ): Promise<void> {
    this.fileId = fileId;
    this.videoElement = videoElement;
    this.destroyed = false;
    this.normalizeInitialAudioTimeline = true;
    this.initialAudioTimelineAnchored = false;
    this.initialAudioPtsOffsetMs = 0;
    this.lastThrottleBypassLogAt = 0;
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
      this.headerBuf = buf;
      this.info = parseMkvMediaInfo(buf, {
        audioTrackNumber: opts?.audioTrackNumber,
      });
      this.audioEmitFilter = this.info.audio?.trackNumber ?? null;

      const wantsExternalAudio =
        opts?.externalAudio === "webcodecs" && !!this.info.audio;
      const useExternalAudio = wantsExternalAudio && this.info.audio
        ? await ExternalMkvAudioRenderer.isSupported(this.info.audio)
        : false;
      if (useExternalAudio && this.info.audio && this.videoElement) {
        this.externalAudio = new ExternalMkvAudioRenderer(
          this.info.audio,
          this.videoElement,
        );
        // eslint-disable-next-line no-console
        console.info(
          `[mse] external audio enabled for track #${this.info.audio.trackNumber} ` +
          `(${this.info.audio.codec}, ${this.info.audio.channels}ch)`,
        );
      }

      // 3. Build per-track init segments
      const videoInit = generateVideoInitSegment(this.info.video);
      const audioInit = this.info.audio && !this.externalAudio
        ? generateAudioInitSegment(this.info.audio)
        : null;
      const videoMime = buildVideoMimeType(this.info.video);
      const audioMime = this.info.audio
        ? buildAudioMimeType(this.info.audio)
        : null;

      // Slice out the cluster portion of the header buffer so we can
      // process it immediately after the init segment is appended.
      // This avoids a redundant fetch of data we already have.
      const clusterData = this.info.firstClusterOffset < buf.length
        ? buf.slice(this.info.firstClusterOffset)
        : null;

      // Tracking offsets — the first processChunk call sees bytes that
      // start at firstClusterOffset; everything beyond that comes from
      // the live stream and starts at the buffer's end.
      this.nextChunkFileOffset = this.info.firstClusterOffset;
      this.fetchOffset = buf.length;

      // 4. Create MediaSource
      markPlayback("remux:start");
      this.mediaSource = new MediaSource();
      this.objectUrl = URL.createObjectURL(this.mediaSource);

      this.mediaSource.addEventListener("sourceopen", async () => {
        if (this.destroyed || !this.mediaSource || !this.info) return;

        try {
          // eslint-disable-next-line no-console
          console.info(
            `[mse] checking codec support: video="${videoMime}" ` +
            `audio="${this.externalAudio ? "external:webcodecs" : audioMime ?? "none"}"`,
          );
          if (!MediaSource.isTypeSupported(videoMime)) {
            // eslint-disable-next-line no-console
            console.error(`[mse] video codec UNSUPPORTED: ${videoMime}`);
            this.fireError(
              new Error(
                `This file's video codec (${videoMime}) isn't supported by your browser. ` +
                `Common causes: 10-bit H.264 (Hi10P), HEVC/H.265, or AV1. ` +
                `For HEVC on Windows, install "HEVC Video Extensions" from the Microsoft Store.`,
              ),
            );
            return;
          }
          if (!this.externalAudio && audioMime && !MediaSource.isTypeSupported(audioMime)) {
            // eslint-disable-next-line no-console
            console.error(`[mse] audio codec UNSUPPORTED: ${audioMime}`);
            this.fireError(
              new Error(
                `This file's audio codec (${audioMime}) isn't supported by your browser.`,
              ),
            );
            return;
          }

          this.videoSourceBuffer = this.mediaSource.addSourceBuffer(videoMime);
          this.videoSourceBuffer.mode = "segments";
          this.videoSourceBuffer.addEventListener("updateend", () => {
            this.drainVideoQueue();
          });
          this.videoSourceBuffer.addEventListener("error", () => {
            const stage = this.videoAppendCount <= 1 ? "init" : "media";
            this.fireError(
              new Error(
                `Video SourceBuffer error (stage=${stage}, mime=${videoMime}, ` +
                `appendCount=${this.videoAppendCount}). ` +
                (stage === "init"
                  ? `The browser refused our init segment — usually a codec/` +
                    `sample-entry mismatch or an unparseable hvcC/avcC config.`
                  : `The browser refused a media fragment after init succeeded — ` +
                    `usually a malformed moof/mdat or unexpected NAL framing.`),
              ),
            );
          });

          if (!this.externalAudio && audioInit && audioMime) {
            this.audioSourceBuffer = this.mediaSource.addSourceBuffer(audioMime);
            this.audioSourceBuffer.mode = "segments";
            this.audioSourceBuffer.addEventListener("updateend", () => {
              this.drainAudioQueue();
            });
            this.audioSourceBuffer.addEventListener("error", () => {
              const stage = this.audioAppendCount <= 1 ? "init" : "media";
              this.fireError(
                new Error(
                  `Audio SourceBuffer error (stage=${stage}, mime=${audioMime}, ` +
                  `appendCount=${this.audioAppendCount}).`,
                ),
              );
            });
          }

          // Append the init segments (queued; drain handlers fire updateend
          // → drainVideoQueue/drainAudioQueue and the cluster data behind
          // them starts flowing).
          this.enqueueVideoAppend(videoInit.data);
          if (!this.externalAudio && audioInit) this.enqueueAudioAppend(audioInit.data);
          this.initDone = true;

          // Process clusters already in the header buffer — this gets the
          // first frame on screen without an extra network round-trip.
          if (clusterData && clusterData.length > 0) {
            await this.processChunk(clusterData);
            if (this.destroyed) return;
          }

          // Continue with a single streaming fetch for the rest of the file.
          this.progressiveStream();
        } catch (e) {
          this.fireError(e instanceof Error ? e : new Error(String(e)));
        }
      });

      videoElement.src = this.objectUrl;
      this.onReady?.(this.objectUrl, this.info.durationMs);
    } catch (e) {
      this.fireError(e instanceof Error ? e : new Error(String(e)));
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
    if (this.audioCatchUpAbort) {
      try { this.audioCatchUpAbort.abort(); } catch { /* ignore */ }
      this.audioCatchUpAbort = null;
    }
    if (this.externalAudio) {
      this.externalAudio.close();
      this.externalAudio = null;
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
    this.videoSourceBuffer = null;
    this.audioSourceBuffer = null;
    this.videoElement = null;
    this.videoAppendQueue = [];
    this.audioAppendQueue = [];
    this.headerBuf = null;
    this.clusterIndex = [];
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

    const MAX_STREAM_RETRIES = 3;
    let streamAttempt = 0;

    while (streamAttempt <= MAX_STREAM_RETRIES && !this.destroyed) {
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
        if (this.destroyed) break;

        const reader = res.body?.getReader();
        if (!reader) {
          // Fallback: ReadableStream not available — read the tail as a single
          // ArrayBuffer. This is the rare path (older WebView only).
          const ab = await res.arrayBuffer();
          if (this.destroyed) break;
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
          // Dynamic trigger size — see the `minProcessSize` update below
          // the processChunk call for the rationale (partial-cluster rework).
          let minProcessSize = STREAM_PROCESS_SIZE;

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

            // Track bytes received so we can resume from here on reconnect.
            this.fetchOffset += value.length;

            // Safety: hard-cap accumulated buffer so a single broken cluster
            // (common with HEVC + FLAC where extractClusterSamples can't make
            // progress) doesn't run the tab out of memory. Abort cleanly
            // instead of OOM-ing.
            const nextLen = (accumulated?.length ?? 0) + value.length;
            if (nextLen > STREAM_MAX_ACCUMULATED) {
              this.fireError(
                new Error(
                  `MSE remux buffer overflow (${(nextLen / 1024 / 1024).toFixed(1)} MB). ` +
                  `This usually means the file's codec combo (often HEVC + FLAC) ` +
                  `produces clusters our remuxer can't parse. Try a different file ` +
                  `or, if your browser supports the codec, force native playback.`,
                ),
              );
              break;
            }

            try {
              accumulated = accumulated
                ? concatBuffers(accumulated, value)
                : value;
            } catch (e) {
              // Defensive: even with the soft cap, V8 can refuse smaller
              // allocations under memory pressure. Surface a clean error.
              this.fireError(
                e instanceof Error
                  ? new Error(`Out of memory while buffering stream: ${e.message}`)
                  : new Error("Out of memory while buffering stream"),
              );
              break;
            }

            if (accumulated.length >= minProcessSize) {
              // Throttle if we're far enough ahead — keeps SourceBuffer small.
              await this.waitUntilBufferNeeded();
              if (this.destroyed) break;

              await this.processChunk(accumulated);
              if (this.destroyed) break;

              // If processChunk saved a large partial cluster back into the
              // leftover, hold off on re-processing until we've grown by
              // a meaningful step. Otherwise every 64 KB network packet
              // re-triggers the >2 MB threshold and re-scans the same
              // unfinished cluster ~75× for one 5 MB HEVC cluster.
              //
              // The step is 512 KB (not a full STREAM_PROCESS_SIZE) so on
              // a slow Drive connection we still make forward progress at
              // a perceptible cadence — waiting for a full extra 2 MB on
              // a 1-2 MB/s connection means visible second-long pauses.
              const leftoverBuf = this.leftoverBuf as Uint8Array | null;
              this.leftoverBuf = null;
              accumulated = leftoverBuf;
              const leftoverBytes =
                leftoverBuf === null ? 0 : (leftoverBuf as Uint8Array).length;
              minProcessSize = leftoverBytes > 0
                ? leftoverBytes + 512 * 1024
                : STREAM_PROCESS_SIZE;

              this.evictOldBuffers();
            }
          }

          if (accumulated && accumulated.length > 0 && !this.destroyed) {
            await this.processChunk(accumulated);
          }

          this.streamReader = null;
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
        }

        // If we reach here without an error, the stream completed successfully.
        // Set fetchOffset to fileSize to signal completion.
        this.fetchOffset = this.fileSize;
        break; // exit retry loop
      } catch (e) {
        this.streamReader = null;
        // Abort-on-destroy raises an AbortError that we swallow silently.
        const isAbort =
          e instanceof DOMException && e.name === "AbortError";
        if (this.destroyed || isAbort) {
          break;
        }

        // Only retry transient errors (network failures, 5xx). Permission
        // errors (403 private-folder), auth errors, etc. are non-retryable —
        // surfacing them immediately avoids wasting API calls and triggering
        // rate-limit cascades.
        const retryable =
          (e instanceof TypeError) ||
          (e instanceof DOMException && e.name === "NetworkError") ||
          (e instanceof Error && "status" in e &&
            typeof (e as { status?: number }).status === "number" &&
            (e as { status: number }).status >= 500);

        streamAttempt++;
        if (!retryable || streamAttempt > MAX_STREAM_RETRIES) {
          this.fireError(e instanceof Error ? e : new Error(String(e)));
          break;
        }

        // eslint-disable-next-line no-console
        console.warn(
          `[mse] stream error (attempt ${streamAttempt}/${MAX_STREAM_RETRIES}), ` +
          `retrying from offset ${this.fetchOffset} in ${streamAttempt * 2}s:`,
          e,
        );
        // Exponential backoff: 2s, 4s, 6s
        await sleep(streamAttempt * 2000);
        // leftoverBuf is preserved — the next iteration will pick up from
        // fetchOffset with any partial data still intact.
      }
    }

    this.fetching = false;
    if (this.fetchOffset >= this.fileSize) {
      this.finalizeStream();
    }
  }

  /**
   * Wait until the playable buffer-ahead threshold allows more data.
   *
   * With split SourceBuffers, the user-perceived playable range is the
   * INTERSECTION of video and audio buffered ranges — `videoEl.buffered`
   * already computes that. Earlier code checked the video buffer alone,
   * which caused a deadlock: video samples are ~10× the byte size of
   * FLAC audio, so the video buffer grows much faster than audio. After
   * a few clusters video would be 30s ahead while audio was 3s ahead,
   * the throttle would say "video is 30s ahead, stop feeding," and the
   * stream stalled — audio never caught up, the playhead never crossed
   * the audio range's end, and the buffer-ahead window never shrank.
   */
  private async waitUntilBufferNeeded(): Promise<void> {
    let logged = false;
    let lastCt = this.videoElement?.currentTime ?? 0;
    let lastAdvanceAt = performance.now();
    while (this.videoElement && !this.destroyed) {
      const playableEnd = this.getPlayableBufferEnd();
      const ct = this.videoElement.currentTime;
      const lead = playableEnd - ct;
      if (lead > BUFFER_AHEAD_SEC) {
        if (
          !this.videoElement.paused &&
          !this.videoElement.ended &&
          (this.videoElement.readyState < 3 || this.videoElement.seeking)
        ) {
          this.logThrottleBypass(
            `[mse] throttle bypass: lead=${lead.toFixed(1)}s but ` +
            `readyState=${this.videoElement.readyState} seeking=${this.videoElement.seeking}; ` +
            `continuing stream feed`,
          );
          break;
        }
        if (!logged) {
          // eslint-disable-next-line no-console
          console.info(
            `[mse] buffer-ahead throttle: playable=${playableEnd.toFixed(1)}s ` +
            `ct=${ct.toFixed(1)}s lead=${lead.toFixed(1)}s ` +
            `readyState=${this.videoElement.readyState} paused=${this.videoElement.paused} ` +
            `video=${formatSourceBufferRanges(this.videoSourceBuffer)} ` +
            `audio=${this.externalAudio ? "external" : formatSourceBufferRanges(this.audioSourceBuffer)} ` +
            `— sleeping until playback drains the lead`,
          );
          logged = true;
        }
        await sleep(500);
        if (!this.videoElement.paused && !this.videoElement.ended) {
          const newCt = this.videoElement.currentTime;
          if (newCt > lastCt + 0.05) {
            lastCt = newCt;
            lastAdvanceAt = performance.now();
          } else if (performance.now() - lastAdvanceAt >= THROTTLE_STALL_ESCAPE_MS) {
            this.logThrottleBypass(
              `[mse] throttle bypass: playhead has not advanced for ` +
              `${THROTTLE_STALL_ESCAPE_MS}ms while lead=${lead.toFixed(1)}s; ` +
              `continuing stream feed`,
            );
            break;
          }
        }
        this.evictOldBuffers();
        continue;
      }
      break;
    }
  }

  private logThrottleBypass(message: string): void {
    const now = performance.now();
    if (now - this.lastThrottleBypassLogAt < THROTTLE_BYPASS_LOG_INTERVAL_MS) {
      return;
    }
    this.lastThrottleBypassLogAt = now;
    // eslint-disable-next-line no-console
    console.info(message);
  }

  /**
   * The min of video and audio buffered ends — what the `<video>` element
   * treats as actually playable. Falls back to whichever buffer exists when
   * only one is active (e.g. video-only MKVs).
   */
  private getPlayableBufferEnd(): number {
    const anchor = this.videoElement?.currentTime ?? 0;
    const vEnd = bufferedRangeEndAt(this.videoSourceBuffer, anchor);
    if (this.externalAudio) {
      const aEnd = this.externalAudio.bufferedUntilSec;
      if (vEnd === 0 || aEnd === 0) return 0;
      return Math.min(vEnd, aEnd);
    }
    if (!this.audioSourceBuffer) return vEnd;
    const aEnd = bufferedRangeEndAt(this.audioSourceBuffer, anchor);
    if (vEnd === 0) return aEnd;
    if (aEnd === 0) return vEnd;
    return Math.min(vEnd, aEnd);
  }

  private finalizeStream(): void {
    this.onStreamComplete?.();
    void this.externalAudio?.flush();
    if (
      !this.destroyed &&
      this.mediaSource?.readyState === "open"
    ) {
      this.waitForAllUpdateEnd().then(() => {
        if (this.mediaSource?.readyState === "open") {
          try { this.mediaSource.endOfStream(); } catch { /* ignore */ }
        }
      });
    }
  }

  /**
   * Demux `data` (a buffer starting at file offset `chunkBaseFileOffset`)
   * and emit per-track media segments into the two SourceBuffers.
   *
   * When `opts.audioOnly` is set, video samples are discarded — this is the
   * mode used by the post-switch audio catch-up fetch, which only needs to
   * re-emit the new dub's audio between `currentTime` and the main stream's
   * current position. The cluster index is NOT updated from catch-up calls
   * (those would create duplicate / out-of-order entries).
   */
  private async processChunk(
    data: Uint8Array,
    opts: {
      audioOnly?: boolean;
      chunkBaseFileOffset?: number;
      updateLeftover?: boolean;
    } = {},
  ): Promise<void> {
    if (!this.info) return;
    const audioOnly = opts.audioOnly === true;
    const updateLeftover = opts.updateLeftover !== false;
    const baseOffset = opts.chunkBaseFileOffset ?? this.nextChunkFileOffset;

    // The main streaming path piggybacks subtitle extraction onto the raw
    // bytes — skip this for catch-up so we don't double-feed the extractor.
    if (!audioOnly) this.onRawChunk?.(data);

    const chunkStarted = performance.now();
    let lastYield = chunkStarted;
    let clustersThisChunk = 0;
    let offset = 0;
    while (offset < data.length) {
      if (data[offset] === 0x00) { offset++; continue; }

      const el = readElement(data, offset);
      if (!el) {
        if (offset < data.length && updateLeftover) {
          this.leftoverBuf = data.slice(offset);
          this.nextChunkFileOffset = baseOffset + offset;
        }
        return;
      }

      if (el.id === MKV_ID.Cluster) {
        // If the cluster's declared size extends past the chunk, defer it.
        // Processing a partial cluster does two bad things: (1) the
        // truncated tail SimpleBlock yields a sample with a length-prefix
        // longer than its actual bytes — Chrome's HEVC parser rejects the
        // media fragment as malformed NAL framing; (2) the next chunk
        // starts mid-cluster and re-reads arbitrary bytes as if they were
        // an EBML element. HEVC clusters routinely run 2-5 MB on BD-rip
        // content, well over STREAM_PROCESS_SIZE, so this fires on most
        // chunk boundaries with HEVC sources.
        //
        // `dataLengthRaw === -1` means an unknown-size cluster — rare, but
        // we have no choice but to process whatever's available, since
        // there's no end marker until EOF.
        if (
          el.dataLengthRaw >= 0 &&
          el.dataOffset + el.dataLengthRaw > data.length
        ) {
          if (updateLeftover) {
            this.leftoverBuf = data.slice(offset);
            this.nextChunkFileOffset = baseOffset + offset;
          }
          return;
        }
        try {
          const samples = extractClusterSamples(data, el, this.info);
          if (samples.length > 0) {
            // Track the cluster's start PTS for catch-up lookups.
            if (!audioOnly) {
              const firstPts = samples[0].pts;
              const clusterFileOffset = baseOffset + el.elementOffset;
              const lastEntry = this.clusterIndex[this.clusterIndex.length - 1];
              if (!lastEntry || lastEntry.fileOffset !== clusterFileOffset) {
                this.clusterIndex.push({
                  fileOffset: clusterFileOffset,
                  ptsMs: firstPts,
                });
              }
            }

            const videoSamples = samples.filter((s) => s.isVideo);
            const audioSamples = samples.filter(
              (s) =>
                !s.isVideo &&
                (this.audioEmitFilter == null ||
                  s.trackNumber === this.audioEmitFilter),
            );

            if (!audioOnly && videoSamples.length > 0) {
              this.videoSeq++;
              const seg = generateVideoMediaSegment(
                videoSamples,
                this.videoSeq,
                this.info.video,
              );
              if (this.videoSeq === 1) markPlayback("remux:first-segment-ready");
              if (seg.length > 0) this.enqueueVideoAppend(seg);
            }

            if (this.externalAudio && audioSamples.length > 0) {
              this.externalAudio.enqueueSamples(audioSamples);
              if (
                this.audioCatchUpTargetMs > 0 &&
                this.externalAudio.bufferedUntilSec * 1000 >=
                  this.audioCatchUpTargetMs
              ) {
                this.audioCatchUpTargetMs = 0;
              }
            } else if (this.info.audio && audioSamples.length > 0) {
              this.audioSeq++;
              const normalizedAudioSamples =
                this.normalizeAudioSamplesForInitialTimeline(audioSamples);
              const seg = generateAudioMediaSegment(
                normalizedAudioSamples,
                this.audioSeq,
                this.info.audio,
              );
              if (seg.length > 0) this.enqueueAudioAppend(seg);
            }
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("Cluster parse error (skipping):", e);
        }

        const clusterEnd = el.elementOffset + el.elementLength;
        offset = Math.min(clusterEnd, data.length);
        clustersThisChunk++;

        // Cooperative yield. Cluster work for a 5 Mbps HEVC source is
        // ~10-30 ms per cluster; a 2 MB chunk often holds 2-3 clusters. If
        // we ran them all back-to-back the main thread would block for
        // ~60+ ms — long enough for the user to feel UI lag and for the
        // SourceBuffer's `updateend` callbacks to pile up behind us.
        if (performance.now() - lastYield >= PROCESS_CHUNK_YIELD_MS) {
          await yieldToMain();
          if (this.destroyed) return;
          lastYield = performance.now();
        }
      } else {
        if (el.dataOffset + el.dataLength > data.length) {
          if (updateLeftover) {
            this.leftoverBuf = data.slice(offset);
            this.nextChunkFileOffset = baseOffset + offset;
          }
          return;
        }
        offset += el.elementLength;
      }
    }

    // Whole chunk consumed cleanly — advance the file-offset tracker so
    // the next call's clusters get correctly-located index entries.
    if (updateLeftover && !audioOnly) {
      this.nextChunkFileOffset = baseOffset + data.length;
      this.leftoverBuf = null;
    }

    // Surface slow chunks so a future regression doesn't sneak in. A
    // healthy chunk on a modern desktop runs ~30-50 ms wall-clock for a
    // 2 MB HEVC payload. Anything past 250 ms reliably feels like UI lag.
    const wall = performance.now() - chunkStarted;
    if (wall > 250 && clustersThisChunk > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mse] slow chunk: ${wall.toFixed(0)} ms for ${(data.length / 1024 / 1024).toFixed(2)} MB ` +
        `(${clustersThisChunk} cluster${clustersThisChunk === 1 ? "" : "s"})`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // SourceBuffer append queues (one per buffer)
  // -------------------------------------------------------------------------

  private enqueueVideoAppend(data: Uint8Array): void {
    this.videoAppendQueue.push(data);
    this.drainVideoQueue();
  }

  private enqueueAudioAppend(data: Uint8Array): void {
    this.audioAppendQueue.push(data);
    this.drainAudioQueue();
  }

  private drainVideoQueue(): void {
    this.drainBufferQueue(this.videoSourceBuffer, this.videoAppendQueue, "video");
  }

  private drainAudioQueue(): void {
    this.drainBufferQueue(this.audioSourceBuffer, this.audioAppendQueue, "audio");
    // Check whether audio has caught up enough to satisfy a pending switch.
    if (this.audioCatchUpTargetMs > 0) {
      const sb = this.audioSourceBuffer;
      if (sb && sb.buffered.length > 0) {
        const lastEnd = sb.buffered.end(sb.buffered.length - 1) * 1000;
        if (lastEnd >= this.audioCatchUpTargetMs) {
          this.audioCatchUpTargetMs = 0;
        }
      }
    }
  }

  /**
   * Shared drain primitive. The `kind` arg is only used for telemetry/error
   * disambiguation. Same QuotaExceeded-retry behaviour as the original
   * single-buffer drain — eviction runs against BOTH buffers so we don't
   * starve one of them when the other fills up.
   */
  private drainBufferQueue(
    sb: SourceBuffer | null,
    queue: Uint8Array[],
    kind: "video" | "audio",
  ): void {
    if (
      this.destroyed ||
      this.errored ||
      !sb ||
      this.mediaSource?.readyState !== "open" ||
      sb.updating ||
      queue.length === 0
    ) {
      return;
    }
    const next = queue.shift()!;
    if (kind === "video") this.videoAppendCount++;
    else this.audioAppendCount++;
    try {
      sb.appendBuffer(
        next.buffer.slice(
          next.byteOffset,
          next.byteOffset + next.byteLength,
        ) as ArrayBuffer,
      );
    } catch (e) {
      if (e instanceof DOMException && e.name === "QuotaExceededError") {
        this.evictOldBuffers();
        queue.unshift(next);
        setTimeout(() => {
          if (kind === "video") this.drainVideoQueue();
          else this.drainAudioQueue();
        }, 500);
      } else {
        this.fireError(e instanceof Error ? e : new Error(String(e)));
      }
    }
  }

  private evictOldBuffers(): void {
    if (!this.videoElement) return;
    const ct = this.videoElement.currentTime;
    const removeEnd = ct - BUFFER_BEHIND_SEC;
    if (removeEnd <= 0) return;
    for (const sb of [this.videoSourceBuffer, this.audioSourceBuffer]) {
      if (!sb || sb.updating) continue;
      const buffered = sb.buffered;
      if (buffered.length > 0 && buffered.start(0) < removeEnd) {
        try {
          sb.remove(buffered.start(0), removeEnd);
        } catch {
          // ignore — most commonly fires when the SourceBuffer is already
          // mid-update from another path.
        }
      }
    }
  }

  /** Wait for both SourceBuffers to finish any pending append. */
  private waitForAllUpdateEnd(): Promise<void> {
    return Promise.all([
      this.waitForUpdateEndOn(this.videoSourceBuffer),
      this.waitForUpdateEndOn(this.audioSourceBuffer),
    ]).then(() => undefined);
  }

  private waitForUpdateEndOn(sb: SourceBuffer | null): Promise<void> {
    return new Promise((resolve) => {
      if (!sb || !sb.updating) {
        resolve();
        return;
      }
      const handler = () => {
        sb.removeEventListener("updateend", handler);
        resolve();
      };
      sb.addEventListener("updateend", handler);
    });
  }

  // -------------------------------------------------------------------------
  // Dub-switch API — split-buffer audio swap (the VLC-feel path)
  // -------------------------------------------------------------------------

  /**
   * Swap the currently-playing audio track in place. The video buffer is
   * untouched; the audio SourceBuffer is reset via `changeType` + new
   * init segment, and a side range-fetch backfills audio between
   * `currentTime` and the main stream's current byte position so the
   * playhead doesn't sit on a silent gap.
   *
   * Returns true when the swap was kicked off (audio init seg already
   * queued). False means: same track / no audio / no header / no MSE.
   */
  async switchAudio(trackNumber: number): Promise<boolean> {
    if (
      this.destroyed ||
      this.errored ||
      !this.info ||
      !this.headerBuf ||
      (!this.audioSourceBuffer && !this.externalAudio) ||
      this.audioSwitching
    ) {
      return false;
    }
    if (this.info.audio?.trackNumber === trackNumber) return false;

    this.audioSwitching = true;
    try {
      // Re-parse the cached header bytes with the requested TrackNumber to
      // pick up the new track's codec private + sample rate + channel count.
      const newInfo = parseMkvMediaInfo(this.headerBuf, {
        audioTrackNumber: trackNumber,
      });
      const newAudio: AudioTrackInfo | undefined = newInfo.audio;
      if (!newAudio || newAudio.trackNumber !== trackNumber) {
        // eslint-disable-next-line no-console
        console.warn(
          `[mse] switchAudio(${trackNumber}): no compatible audio track ` +
          `in cached header (got ${newAudio?.trackNumber ?? "none"})`,
        );
        return false;
      }
      const newMime = buildAudioMimeType(newAudio);
      const externalAudio = this.externalAudio;
      if (externalAudio) {
        const supported = await ExternalMkvAudioRenderer.isSupported(newAudio);
        if (!supported) {
          // eslint-disable-next-line no-console
          console.warn(
            `[mse] switchAudio(${trackNumber}): external decoder rejects ` +
            `"${newAudio.codec}"`,
          );
          return false;
        }
      } else if (!MediaSource.isTypeSupported(newMime)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[mse] switchAudio(${trackNumber}): browser rejects "${newMime}"`,
        );
        return false;
      }

      const playheadMs = (this.videoElement?.currentTime ?? 0) * 1000;

      // Cancel any prior catch-up before starting a new one.
      if (this.audioCatchUpAbort) {
        try { this.audioCatchUpAbort.abort(); } catch { /* ignore */ }
        this.audioCatchUpAbort = null;
      }

      if (externalAudio) {
        await externalAudio.switchTrack(newAudio);
        if (this.destroyed) return false;
      } else {
        const audioSB = this.audioSourceBuffer;
        if (!audioSB) return false;

        // Drop pending appends — they're for the old track.
        this.audioAppendQueue = [];

        // Wait for any active append to finish before changeType. MSE forbids
        // changeType while `updating` is true.
        await this.waitForUpdateEndOn(audioSB);
        if (this.destroyed) return false;

        // Reset the audio buffer's timeline so the new init segment is honoured.
        try {
          audioSB.changeType(newMime);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[mse] audioSB.changeType failed:", e);
          return false;
        }
      }

      // Switch the demuxer's reference to the new audio track BEFORE
      // appending the new init segment so subsequent stream emissions
      // belong to the new dub.
      this.info.audio = newAudio;
      this.audioEmitFilter = newAudio.trackNumber;
      this.audioSeq = 0;
      this.audioCatchUpTargetMs = playheadMs;
      this.normalizeInitialAudioTimeline = false;
      this.initialAudioTimelineAnchored = true;
      this.initialAudioPtsOffsetMs = 0;

      if (!externalAudio) {
        const newInit = generateAudioInitSegment(newAudio);
        this.enqueueAudioAppend(newInit.data);
      }

      // Kick off the catch-up: parallel range fetch from the cluster covering
      // playhead (minus a small lookback) to the main stream's current byte
      // position. Demuxes audio for the new TrackNumber and feeds the audio
      // buffer until it catches up.
      this.startAudioCatchUp(playheadMs).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[mse] audio catch-up failed:", e);
      });

      // eslint-disable-next-line no-console
      console.info(
        `[mse] switchAudio → track #${trackNumber} (${newAudio.codec}, ` +
        `${newAudio.channels}ch); catch-up target=${(playheadMs / 1000).toFixed(2)}s`,
      );
      return true;
    } finally {
      this.audioSwitching = false;
    }
  }

  private normalizeAudioSamplesForInitialTimeline(
    samples: DemuxedSample[],
  ): DemuxedSample[] {
    if (
      !this.normalizeInitialAudioTimeline ||
      samples.length === 0 ||
      this.audioCatchUpTargetMs > 0
    ) {
      return samples;
    }

    if (!this.initialAudioTimelineAnchored) {
      const firstPts = samples[0].pts;
      this.initialAudioPtsOffsetMs =
        firstPts >= AUDIO_TIMELINE_NORMALIZE_THRESHOLD_MS ? firstPts : 0;
      this.initialAudioTimelineAnchored = true;
      if (this.initialAudioPtsOffsetMs > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[mse] normalizing initial audio timeline by ` +
          `-${(this.initialAudioPtsOffsetMs / 1000).toFixed(3)}s ` +
          `so rollback/seek targets before the first audio packet remain playable`,
        );
      }
    }

    if (this.initialAudioPtsOffsetMs <= 0) return samples;

    return samples.map((s) => ({
      ...s,
      pts: Math.max(0, s.pts - this.initialAudioPtsOffsetMs),
    }));
  }

  /**
   * Side range-fetch that backfills audio between `playheadMs` and the main
   * stream's current byte position so a swap doesn't leave a silent gap.
   * Uses the cluster index built by the main stream to map PTS → byte
   * offset; falls back to the latest indexed cluster when no earlier match
   * exists.
   */
  private async startAudioCatchUp(playheadMs: number): Promise<void> {
    if (!this.info) return;
    if (this.clusterIndex.length === 0) return;

    // Find the latest cluster index entry whose pts ≤ playheadMs - lookback.
    // 500 ms of lookback gives the FLAC/AAC decoder time to lock before
    // hitting the playhead even if the cluster doesn't start exactly there.
    const lookbackMs = 500;
    const targetMs = Math.max(0, playheadMs - lookbackMs);
    let pick = this.clusterIndex[0];
    for (const e of this.clusterIndex) {
      if (e.ptsMs <= targetMs) pick = e;
      else break;
    }
    const startOffset = pick.fileOffset;
    const endOffset = Math.max(startOffset, this.fetchOffset);
    if (endOffset <= startOffset) return;

    this.audioCatchUpAbort = new AbortController();
    const linkedSignal = this.audioCatchUpAbort.signal;
    const url = buildMediaUrl(this.fileId);
    const res = await authedFetch(
      url,
      {
        headers: { Range: `bytes=${startOffset}-${endOffset - 1}` },
        signal: linkedSignal,
      },
      { kind: "media-range", priority: "critical", signal: linkedSignal },
    );
    if (this.destroyed) return;
    const ab = await res.arrayBuffer();
    if (this.destroyed) return;
    const data = new Uint8Array(ab);

    // eslint-disable-next-line no-console
    console.info(
      `[mse] audio catch-up: ${((endOffset - startOffset) / 1024 / 1024).toFixed(2)} MB ` +
      `from cluster@pts=${(pick.ptsMs / 1000).toFixed(2)}s`,
    );

    // Demux audio-only out of the fetched window. Do NOT touch
    // nextChunkFileOffset / leftoverBuf — those belong to the main stream.
    await this.processChunk(data, {
      audioOnly: true,
      chunkBaseFileOffset: startOffset,
      updateLeftover: false,
    });
    this.audioCatchUpAbort = null;
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

function bufferedRangeEndAt(sb: SourceBuffer | null, anchorSec: number): number {
  if (!sb) return 0;
  const b = sb.buffered;
  if (b.length === 0) return 0;

  const anchorStart = Math.max(0, anchorSec - BUFFER_RANGE_TOLERANCE_SEC);
  const anchorEnd = anchorSec + BUFFER_RANGE_TOLERANCE_SEC;
  let end = 0;
  let found = false;

  for (let i = 0; i < b.length; i++) {
    const start = b.start(i);
    const rangeEnd = b.end(i);
    if (!found) {
      if (rangeEnd < anchorStart) continue;
      if (start > anchorEnd) break;
      found = true;
      end = rangeEnd;
      continue;
    }
    if (start > end + BUFFER_RANGE_TOLERANCE_SEC) break;
    end = Math.max(end, rangeEnd);
  }

  return found ? end : 0;
}

function formatSourceBufferRanges(sb: SourceBuffer | null): string {
  if (!sb) return "none";
  try {
    const b = sb.buffered;
    if (b.length === 0) return "[]";
    const ranges: string[] = [];
    for (let i = 0; i < b.length && i < 3; i++) {
      ranges.push(`${b.start(i).toFixed(1)}-${b.end(i).toFixed(1)}`);
    }
    if (b.length > 3) ranges.push(`+${b.length - 3}`);
    return `[${ranges.join(",")}]`;
  } catch {
    return "[unavailable]";
  }
}

function concatBuffers(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * True 0 ms yield to the event loop. Used inside `processChunk` to break up
 * long remux runs so the browser can repaint, fire `updateend` for queued
 * appends, and process user input between clusters.
 *
 * Implementation note: we create a fresh `MessageChannel` per call and
 * assign `port1.onmessage` directly (which implicitly starts the port).
 * Earlier versions tried `scheduler.yield()` first and reused a single
 * channel across calls; both paths hung intermittently in production —
 * `scheduler.yield` is feature-flagged in some Chrome builds, and a shared
 * channel with `once:true` listeners is fragile when calls overlap. A
 * fresh channel is ~few KB of garbage, well worth the reliability. A
 * setTimeout safety net guarantees resolution even if the channel never
 * delivers, so processChunk can never deadlock here.
 */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const fin = () => {
      if (done) return;
      done = true;
      resolve();
    };
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      fin();
    };
    ch.port2.postMessage(null);
    // Safety net — if MessageChannel dispatch is somehow blocked (we've
    // seen this on a small number of Chrome builds), fall back to a
    // macrotask so processChunk doesn't deadlock at the yield point.
    setTimeout(fin, 50);
  });
}
