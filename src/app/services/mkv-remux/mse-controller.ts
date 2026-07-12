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
 * (If a pre-fetched header is provided, only 1 streaming fetch.) AC-3 tracks
 * may spend one tiny extra range when attachments push the first sync frame
 * beyond the header preload, so the MP4 `dac3` box can be exact.
 */

import { readElement, MKV_ID } from "../ebml";
import {
  parseMkvMediaInfo,
  extractClusterSamples,
  extractClusterSamplesFromRange,
  findFirstClusterOffset,
  parseAc3SpecificBoxFields,
} from "./demuxer";
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
import type { MediaByteSource } from "../media-source/byte-source";
import {
  useRateLimitStore,
  isCoolingDown,
} from "../drive/rate-limit-store";
import { markPlayback } from "../playback-telemetry";
import { ExternalMkvAudioRenderer } from "./external-audio-renderer";
import type { MkvMediaInfo, AudioTrackInfo, DemuxedSample } from "./types";

const HEADER_FETCH_SIZE = 4 * 1024 * 1024; // 4 MB — enough for header + several clusters
const AC3_CONFIG_PROBE_SIZE = 1024 * 1024;
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
/** Largest plausible non-Cluster top-level element. Real Cues/Attachments/Tags
 *  rarely cross 10 MB; anything bigger between clusters means we landed in
 *  mid-cluster content and `dataLengthRaw` decoded from garbage bytes. */
const NON_CLUSTER_MAX_DECLARED_SIZE = 32 * 1024 * 1024;
const BUFFER_AHEAD_SEC = 30;                // how far ahead to keep buffered
const BUFFER_BEHIND_SEC = 60;               // how far behind to keep
const BUFFER_RANGE_TOLERANCE_SEC = 0.25;    // bridge tiny fMP4 timestamp gaps
const MAX_PENDING_APPEND_SEGMENTS = 16;
const MAX_PENDING_APPEND_BYTES = 24 * 1024 * 1024;
const APPEND_BACKPRESSURE_SLEEP_MS = 50;
const THROTTLE_STALL_ESCAPE_MS = 2500;      // don't sleep if playback is stuck
const AUDIO_TIMELINE_NORMALIZE_THRESHOLD_MS = 500;
const INITIAL_TIMELINE_NORMALIZE_MAX_PLAYHEAD_MS = 2_000;
const THROTTLE_BYPASS_LOG_INTERVAL_MS = 5000;
const SEEK_AUDIO_CATCH_UP_AHEAD_MS = 20_000;
const SEEK_AUDIO_CATCH_UP_MAX_BYTES = 32 * 1024 * 1024;
const SEEK_MEDIA_CATCH_UP_AHEAD_MS = 30_000;
const SEEK_MEDIA_CATCH_UP_MAX_BYTES = 48 * 1024 * 1024;
const SEEK_VIDEO_BUFFER_WAIT_MS = 5_000;

// Stop reading the stream entirely when the video has been paused this long.
// We don't tear down the connection — we just stop pulling bytes. Drive will
// close the conn from its side after a while, which is fine; the next play
// will reopen from the current offset. This keeps a paused tab from chewing
// through quota for a video the user may never resume.
const PAUSE_IDLE_MS = 60_000;
const FORCED_PROCESS_MARGIN = 512 * 1024;
const STREAM_FORCE_PROCESS_MAX = STREAM_MAX_ACCUMULATED + 4 * 1024 * 1024;
const EBML_MAX_HEADER_BYTES = 12;
const CLUSTER_ID_TAIL_BYTES = 3;

interface PartialClusterState {
  clusterFileOffset: number;
  dataEndFileOffset: number | null;
  clusterTimeMs: number;
  indexed: boolean;
}

interface ClusterIndexEntry {
  fileOffset: number;
  ptsMs: number;
  hasVideoKeyframe: boolean;
}

/**
 * Error raised when an audio SourceBuffer rejects an append. `stage: "init"`
 * means the very first append (the fMP4 init segment) failed — typically a
 * browser that reported `MediaSource.isTypeSupported` true but cannot actually
 * decode this codec. The UI uses this marker to transparently restart on the
 * external WebCodecs audio path instead of stranding the user on an error.
 */
export interface MseAudioInitError extends Error {
  mseAudioFailure?: { stage: "init" | "media"; mime: string };
}

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
  /** When set, byte reads/streams come from this source instead of Drive
   *  Range-fetches — used for local files (see `LocalFileByteSource`). */
  private byteSource: MediaByteSource | null = null;
  private fileSize = 0;
  private fetchOffset = 0;
  private videoSeq = 0;
  private audioSeq = 0;
  private videoNextDtsMs: number | null = null;
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
  /** Streaming state for a Cluster too large to hold until its declared end.
   *  We parse complete child blocks as they arrive and keep only the
   *  unfinished child tail between reads. */
  private partialCluster: PartialClusterState | null = null;
  /**
   * Sparse cluster index built incrementally as the main stream parses
   * clusters. Each entry is `(fileOffset, ptsMs)` of a cluster start. When
   * the user switches dubs we binary-search this to find the nearest
   * cluster ≤ `currentTime` and start a parallel range-fetch from there
   * so the new audio fills the buffer back to where the main stream is.
   */
  private clusterIndex: ClusterIndexEntry[] = [];
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
  /**
   * Companion to the audio-side normalization: when the very first video
   * cluster's PTS is well past zero (which happens when a resync inside
   * processChunk skipped past the early clusters, or when a muxer wrote a
   * non-zero base timecode), we shift the VIDEO timeline back to zero too,
   * and pin the audio shift to the same value so the two tracks stay in
   * sync. Without this, the user-perceived `<video>` buffer starts at e.g.
   * 13.4s while audio is shifted to 0 — currentTime sits at 0 with no
   * video data, and playback buffers forever.
   */
  private initialVideoTimelineAnchored = false;
  private initialVideoPtsOffsetMs = 0;
  /** Side range-fetch reader used by `switchAudio` to backfill audio between
   *  `currentTime` and the main stream's position. */
  private audioCatchUpAbort: AbortController | null = null;
  private audioCatchUpSerial = 0;
  /** Optional VLC-style audio path: WebCodecs decodes FLAC outside MSE. */
  private externalAudio: ExternalMkvAudioRenderer | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private initDone = false;
  private streamReader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  /** Aborts the active fetch when destroy() runs or the user navigates away. */
  private abortController: AbortController | null = null;
  private streamRestartOffset: number | null = null;
  /** Set when document.visibilityState becomes "hidden" (or video paused too
   *  long); the streaming loop suspends until this clears. */
  private suspended = false;
  /** Flipped to true by the pause-idle timer; cleared by `play`. */
  private pausedTooLong = false;
  /** Cleanup functions registered while running; called from destroy(). */
  private cleanups: Array<() => void> = [];
  private lastThrottleBypassLogAt = 0;
  private externalAudioSeekCatchUpTimer: number | null = null;
  private mediaSeekCatchUpActive = false;

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
   * @param opts.knownFileSize Authoritative total size (bytes) from Drive
   *   metadata. Wins over the Content-Range-derived size, which a cross-origin
   *   fetch can't read on the web build — without it `this.fileSize` collapses
   *   to the 4 MB header chunk and the progressive streamer stops immediately
   *   (no audio/video body ever reaches the SourceBuffers).
   * @param opts.byteSource When set, all byte reads come from this source
   *   (e.g. a local `File`) instead of Drive Range-fetches.
   */
  async start(
    fileId: string,
    videoElement: HTMLVideoElement,
    preloaded?: { buf: Uint8Array; fileSize: number },
    opts?: {
      audioTrackNumber?: number;
      externalAudio?: "webcodecs";
      knownFileSize?: number;
      byteSource?: MediaByteSource;
    },
  ): Promise<void> {
    this.fileId = fileId;
    this.byteSource = opts?.byteSource ?? null;
    this.videoElement = videoElement;
    this.destroyed = false;
    this.videoSeq = 0;
    this.audioSeq = 0;
    this.videoNextDtsMs = null;
    this.normalizeInitialAudioTimeline = true;
    this.initialAudioTimelineAnchored = false;
    this.initialAudioPtsOffsetMs = 0;
    this.initialVideoTimelineAnchored = false;
    this.initialVideoPtsOffsetMs = 0;
    this.partialCluster = null;
    this.lastThrottleBypassLogAt = 0;
    this.streamRestartOffset = null;
    this.mediaSeekCatchUpActive = false;
    this.abortController = new AbortController();
    this.installBackpressureHooks(videoElement);

    try {
      let buf: Uint8Array;

      // Drive metadata size wins over any Content-Range-derived value (which is
      // unreadable cross-origin on the web build — see the `knownFileSize` doc).
      const trustedSize =
        Number.isFinite(opts?.knownFileSize) &&
        (opts?.knownFileSize as number) > 0
          ? (opts?.knownFileSize as number)
          : 0;

      if (preloaded) {
        buf = preloaded.buf;
        this.fileSize = trustedSize || preloaded.fileSize;
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
        this.fileSize = trustedSize || result.total;
        // eslint-disable-next-line no-console
        console.info(`[mse] header arrived; fileSize=${this.fileSize}`);
      }

      // 2. Parse MKV header
      this.headerBuf = buf;
      this.info = parseMkvMediaInfo(buf, {
        audioTrackNumber: opts?.audioTrackNumber,
      });
      await this.hydrateAc3ConfigFromClusterProbe();
      if (this.destroyed || !this.info) return;
      this.audioEmitFilter = this.info.audio?.trackNumber ?? null;

      const wantsExternalAudio =
        opts?.externalAudio === "webcodecs" && !!this.info.audio;
      const externalSupported = wantsExternalAudio && this.info.audio
        ? await ExternalMkvAudioRenderer.isSupported(this.info.audio)
        : false;
      const useExternalAudio =
        wantsExternalAudio &&
        !!this.info.audio &&
        (externalSupported || this.info.audio.codec === "ac3");
      if (
        wantsExternalAudio &&
        this.info.audio?.codec === "ac3" &&
        !externalSupported
      ) {
        // eslint-disable-next-line no-console
        console.warn(
          `[mse] WebCodecs AC-3 support probe failed; attempting external ` +
          `audio renderer anyway for test mode.`,
        );
      }
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
      this.fetchOffset = Math.max(buf.length, this.info.firstClusterOffset);

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
            if (this.info.audio?.codec === "ac3") {
              // eslint-disable-next-line no-console
              console.warn(
                `[mse] audio codec probe rejected ${audioMime}, but AC-3 ` +
                `testing is enabled; attempting addSourceBuffer anyway.`,
              );
            } else {
              // eslint-disable-next-line no-console
              console.error(`[mse] audio codec UNSUPPORTED: ${audioMime}`);
              this.fireError(
                new Error(
                  `This file's audio codec (${audioMime}) isn't supported by your browser.`,
                ),
              );
              return;
            }
          }

          const durationSeconds = this.info.durationMs / 1000;
          if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
            try {
              this.mediaSource.duration = durationSeconds;
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("[mse] failed to publish media duration:", e);
            }
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
              const err: MseAudioInitError = new Error(
                `Audio SourceBuffer error (stage=${stage}, mime=${audioMime}, ` +
                `appendCount=${this.audioAppendCount}).`,
              );
              err.mseAudioFailure = { stage, mime: audioMime };
              this.fireError(err);
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

          // If the first Cluster begins just past the preloaded header window,
          // or header parsing stopped at a partial element that starts after
          // the stream offset, do not re-fetch the bytes before that element.
          // Re-feeding those bytes ahead of `leftoverBuf` makes the parser
          // see arbitrary mid-element data as a fresh EBML element and the
          // accumulator grows until the overflow guard trips.
          if (this.nextChunkFileOffset > this.fetchOffset) {
            // eslint-disable-next-line no-console
            console.info(
              `[mse] advancing stream offset from ${this.fetchOffset} ` +
              `to ${this.nextChunkFileOffset} to align with next EBML element`,
            );
            this.fetchOffset = this.nextChunkFileOffset;
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

  private async hydrateAc3ConfigFromClusterProbe(): Promise<void> {
    const info = this.info;
    const audio = info?.audio;
    if (
      !info ||
      !audio ||
      audio.codec !== "ac3" ||
      audio.ac3 ||
      info.firstClusterOffset <= 0 ||
      this.fileSize <= 0
    ) {
      return;
    }

    const start = Math.min(info.firstClusterOffset, this.fileSize - 1);
    const end = Math.min(this.fileSize - 1, start + AC3_CONFIG_PROBE_SIZE - 1);
    if (end <= start) return;

    try {
      const { buf } = await this.fetchRange(start, end);
      if (this.destroyed || !this.info) return;
      const clusterOffset = findFirstClusterOffset(buf, 0, buf.length);
      if (clusterOffset == null) return;
      const cluster = readElement(buf, clusterOffset);
      if (!cluster || cluster.id !== MKV_ID.Cluster) return;

      const samples = extractClusterSamples(buf, cluster, this.info);
      for (const sample of samples) {
        if (
          sample.isVideo ||
          sample.trackNumber !== this.info.audio?.trackNumber
        ) {
          continue;
        }
        const ac3 = parseAc3SpecificBoxFields(sample.data);
        if (!ac3) continue;

        const nextAudio = { ...this.info.audio, ac3 };
        this.info = {
          ...this.info,
          audio: nextAudio,
          audioTracks: this.info.audioTracks.map((track) =>
            track.trackNumber === nextAudio.trackNumber
              ? { ...track, ac3 }
              : track,
          ),
        };
        // eslint-disable-next-line no-console
        console.info(
          `[mse] AC-3 config from first sync frame: ` +
          `track=${nextAudio.trackNumber} fscod=${ac3.fscod} ` +
          `bsid=${ac3.bsid} bsmod=${ac3.bsmod} acmod=${ac3.acmod} ` +
          `lfeon=${ac3.lfeon} bitRateCode=${ac3.bitRateCode}`,
        );
        return;
      }
    } catch (e) {
      // Fall back to a valid conservative dac3 box; AC-3 frame headers still
      // carry the real stream facts for decoders that proceed past init.
      // eslint-disable-next-line no-console
      console.warn("[mse] AC-3 config probe failed:", e);
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
    if (this.externalAudioSeekCatchUpTimer !== null) {
      window.clearTimeout(this.externalAudioSeekCatchUpTimer);
      this.externalAudioSeekCatchUpTimer = null;
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
    this.streamRestartOffset = null;
    this.mediaSeekCatchUpActive = false;
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

    const scheduleExternalAudioSeekCatchUp = (trigger: "seeking" | "seeked") => {
      if (!this.externalAudio || this.destroyed) return;
      const catchUpSerial = ++this.audioCatchUpSerial;
      if (this.audioCatchUpAbort) {
        try { this.audioCatchUpAbort.abort(); } catch { /* ignore */ }
        this.audioCatchUpAbort = null;
      }
      if (this.externalAudioSeekCatchUpTimer !== null) {
        window.clearTimeout(this.externalAudioSeekCatchUpTimer);
      }
      // `seeking` fires before the external renderer's own reset listener in
      // this controller's registration order. Debounce the refill so it lands
      // after Web Audio nodes and AC-3 decoder state have been cleared. Keep
      // `seeked` too; quick in-buffer jumps will replace this timer with the
      // final settled playhead.
      const delayMs = trigger === "seeking" ? 120 : 40;
      this.externalAudioSeekCatchUpTimer = window.setTimeout(() => {
        this.externalAudioSeekCatchUpTimer = null;
        if (!this.externalAudio || this.destroyed || !this.videoElement) return;
        const playheadMs = this.videoElement.currentTime * 1000;
        this.audioCatchUpTargetMs = playheadMs;
        const hasVideoAtTarget = this.isVideoBufferedAt(playheadMs / 1000);
        const catchUp = hasVideoAtTarget
          ? this.startAudioCatchUp(playheadMs, "seek", catchUpSerial)
          : this.startMediaSeekCatchUp(playheadMs, catchUpSerial);
        catchUp.catch((e) => {
          if (isAbortError(e)) return;
          // eslint-disable-next-line no-console
          console.warn("[mse] external seek catch-up failed:", e);
        });
      }, delayMs);
    };
    const onExternalAudioSeeking = () =>
      scheduleExternalAudioSeekCatchUp("seeking");
    const onExternalAudioSeeked = () =>
      scheduleExternalAudioSeekCatchUp("seeked");
    videoEl.addEventListener("seeking", onExternalAudioSeeking);
    videoEl.addEventListener("seeked", onExternalAudioSeeked);
    this.cleanups.push(() => {
      videoEl.removeEventListener("seeking", onExternalAudioSeeking);
      videoEl.removeEventListener("seeked", onExternalAudioSeeked);
      if (this.externalAudioSeekCatchUpTimer !== null) {
        window.clearTimeout(this.externalAudioSeekCatchUpTimer);
        this.externalAudioSeekCatchUpTimer = null;
      }
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

  private async waitWhileMediaSeekCatchUpActive(): Promise<void> {
    while (!this.destroyed && this.mediaSeekCatchUpActive) {
      await sleep(50);
    }
  }

  private requestStreamRestart(offset: number): void {
    const bounded = Math.max(0, Math.min(offset, this.fileSize));
    this.streamRestartOffset = bounded;
    this.leftoverBuf = null;
    this.partialCluster = null;
    this.videoNextDtsMs = null;
    try {
      void this.streamReader?.cancel();
    } catch {
      // ignore; the streaming loop will notice streamRestartOffset anyway
    }
    if (!this.fetching && this.mediaSource?.readyState === "open") {
      void this.progressiveStream();
    }
  }

  private consumeStreamRestartOffset(): number | null {
    const offset = this.streamRestartOffset;
    if (offset == null) return null;
    this.streamRestartOffset = null;
    this.fetchOffset = offset;
    this.nextChunkFileOffset = offset;
    this.leftoverBuf = null;
    this.partialCluster = null;
    this.videoNextDtsMs = null;
    // eslint-disable-next-line no-console
    console.info(
      `[mse] restarting media stream from byte ${offset} after seek recovery`,
    );
    return offset;
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
    if (this.streamRestartOffset != null) {
      this.consumeStreamRestartOffset();
    }
    if (this.fetchOffset >= this.fileSize) {
      this.finalizeStream();
      return;
    }
    this.fetching = true;

    const MAX_STREAM_RETRIES = 3;
    let streamAttempt = 0;

    while (streamAttempt <= MAX_STREAM_RETRIES && !this.destroyed) {
      try {
        if (this.streamRestartOffset != null) {
          this.consumeStreamRestartOffset();
          streamAttempt = 0;
        }
        const reader = await this.openByteStream(this.fetchOffset);
        if (this.destroyed) break;

        {
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
            if (this.mediaSeekCatchUpActive) {
              await this.waitWhileMediaSeekCatchUpActive();
              if (this.destroyed) break;
              if (this.streamRestartOffset != null) break;
            }

            const { done, value } = await reader.read();
            if (done) break;

            // Track bytes received so we can resume from here on reconnect.
            this.fetchOffset += value.length;

            // Safety: hard-cap accumulated buffer so a single broken cluster
            // (common with HEVC + FLAC where extractClusterSamples can't make
            // progress) doesn't run the tab out of memory. Abort cleanly
            // instead of OOM-ing.
            let nextLen = (accumulated?.length ?? 0) + value.length;
            if (
              nextLen > STREAM_MAX_ACCUMULATED &&
              accumulated &&
              accumulated.length > 0
            ) {
              if (nextLen <= STREAM_FORCE_PROCESS_MAX) {
                // We are just over the soft guard. Include this stream packet
                // and parse immediately; it may be the packet that completes
                // the pending EBML child element.
                // eslint-disable-next-line no-console
                console.warn(
                  `[mse] accumulator crossed soft cap; parsing with incoming chunk: ` +
                  this.describeAccumulationState(accumulated, value),
                );
                try {
                  accumulated = concatBuffers(accumulated, value);
                } catch (e) {
                  this.fireError(
                    e instanceof Error
                      ? new Error(`Out of memory while buffering stream: ${e.message}`)
                      : new Error("Out of memory while buffering stream"),
                  );
                  break;
                }
                await this.waitUntilBufferNeeded();
                if (this.destroyed) break;
                await this.processChunk(accumulated);
                if (this.destroyed) break;

                const leftoverBuf = this.leftoverBuf as Uint8Array | null;
                this.leftoverBuf = null;
                accumulated = leftoverBuf;
                const leftoverBytes =
                  leftoverBuf === null ? 0 : (leftoverBuf as Uint8Array).length;
                minProcessSize = leftoverBytes > 0
                  ? Math.min(
                      leftoverBytes + FORCED_PROCESS_MARGIN,
                      STREAM_MAX_ACCUMULATED - FORCED_PROCESS_MARGIN,
                    )
                  : STREAM_PROCESS_SIZE;
                this.evictOldBuffers();
                continue;
              }

              // Give the demuxer one last chance to consume what it already
              // has before tripping the guard. Large Opus/HEVC clusters can
              // leave us waiting on one child element; the next stream packet
              // may complete it, but `nextLen` can cross the cap before the
              // normal minProcessSize threshold fires.
              // eslint-disable-next-line no-console
              console.warn(
                `[mse] accumulator near cap; forcing parse before overflow: ` +
                this.describeAccumulationState(accumulated, value),
              );
              await this.waitUntilBufferNeeded();
              if (this.destroyed) break;
              await this.processChunk(accumulated);
              if (this.destroyed) break;

              const leftoverBuf = this.leftoverBuf as Uint8Array | null;
              this.leftoverBuf = null;
              accumulated = leftoverBuf;
              const leftoverBytes =
                leftoverBuf === null ? 0 : (leftoverBuf as Uint8Array).length;
              minProcessSize = leftoverBytes > 0
                ? Math.min(
                    leftoverBytes + FORCED_PROCESS_MARGIN,
                    STREAM_MAX_ACCUMULATED - FORCED_PROCESS_MARGIN,
                  )
                : STREAM_PROCESS_SIZE;
              nextLen = (accumulated?.length ?? 0) + value.length;
            }

            if (nextLen > STREAM_MAX_ACCUMULATED) {
              this.fireError(
                new Error(
                  `MSE remux buffer overflow (${(nextLen / 1024 / 1024).toFixed(1)} MB). ` +
                  `This usually means the file has unusually large MKV elements ` +
                  `or a codec combo our remuxer can't parse. ` +
                  this.describeAccumulationState(accumulated, value),
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

          if (
            accumulated &&
            accumulated.length > 0 &&
            !this.destroyed &&
            this.streamRestartOffset == null
          ) {
            await this.processChunk(accumulated);
          }

          this.streamReader = null;
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
        }

        if (this.streamRestartOffset != null && !this.destroyed) {
          this.consumeStreamRestartOffset();
          streamAttempt = 0;
          continue;
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
      await this.waitForAppendBackpressure();
      if (this.destroyed) break;

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

  private async waitForAppendBackpressure(): Promise<void> {
    let logged = false;
    while (
      !this.destroyed &&
      this.mediaSource?.readyState === "open" &&
      this.hasAppendBackpressure()
    ) {
      if (!logged) {
        // eslint-disable-next-line no-console
        console.info(
          `[mse] append backpressure: videoQueue=${this.videoAppendQueue.length} ` +
          `audioQueue=${this.audioAppendQueue.length} ` +
          `pending=${formatByteCount(this.pendingAppendBytes())}; ` +
          `waiting for SourceBuffers to drain`,
        );
        logged = true;
      }
      this.drainVideoQueue();
      this.drainAudioQueue();
      await sleep(APPEND_BACKPRESSURE_SLEEP_MS);
    }
  }

  private hasAppendBackpressure(): boolean {
    const pendingSegments =
      this.videoAppendQueue.length + this.audioAppendQueue.length;
    if (pendingSegments > MAX_PENDING_APPEND_SEGMENTS) return true;
    return this.pendingAppendBytes() > MAX_PENDING_APPEND_BYTES;
  }

  private pendingAppendBytes(): number {
    let total = 0;
    for (const seg of this.videoAppendQueue) total += seg.byteLength;
    for (const seg of this.audioAppendQueue) total += seg.byteLength;
    return total;
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
    if (vEnd === 0 || aEnd === 0) return 0;
    return Math.min(vEnd, aEnd);
  }

  private isVideoBufferedAt(anchorSec: number): boolean {
    return bufferedRangeEndAt(this.videoSourceBuffer, anchorSec) > anchorSec;
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
      shouldContinue?: () => boolean;
      audioPtsMinMs?: number;
      audioPtsMaxMs?: number;
      videoPtsMinMs?: number;
      videoPtsMaxMs?: number;
      suppressRawChunk?: boolean;
      updateClusterIndex?: boolean;
      randomAccessVideo?: boolean;
    } = {},
  ): Promise<void> {
    if (!this.info) return;
    const audioOnly = opts.audioOnly === true;
    const updateLeftover = opts.updateLeftover !== false;
    const baseOffset = opts.chunkBaseFileOffset ?? this.nextChunkFileOffset;
    const shouldContinue = opts.shouldContinue;
    if (shouldContinue && !shouldContinue()) return;
    const isMainStreamChunk =
      !audioOnly && !opts.suppressRawChunk && updateLeftover;
    if (isMainStreamChunk) {
      await this.waitWhileMediaSeekCatchUpActive();
      if (this.destroyed) return;
    }

    // The main streaming path piggybacks subtitle extraction onto the raw
    // bytes — skip this for catch-up so we don't double-feed the extractor.
    if (!audioOnly && !opts.suppressRawChunk) this.onRawChunk?.(data);

    const chunkStarted = performance.now();
    let lastYield = chunkStarted;
    let clustersThisChunk = 0;
    let offset = 0;

    if (!audioOnly && updateLeftover && this.partialCluster) {
      const partial = this.processPartialClusterContinuation(data, baseOffset);
      clustersThisChunk += partial.completed ? 1 : 0;
      if (partial.waitingForMore) return;
      offset = partial.nextOffset;
    }

    while (offset < data.length) {
      if (shouldContinue && !shouldContinue()) return;
      if (isMainStreamChunk && this.mediaSeekCatchUpActive) {
        await this.waitWhileMediaSeekCatchUpActive();
        if (this.destroyed) return;
      }
      if (data[offset] === 0x00) { offset++; continue; }

      const el = readElement(data, offset);
      if (!el) {
        if (offset < data.length && updateLeftover) {
          const remaining = data.length - offset;
          if (remaining > EBML_MAX_HEADER_BYTES) {
            const resync = this.resyncToNextClusterOrKeepTail(
              data,
              baseOffset,
              offset,
              `invalid EBML element header at file offset ${baseOffset + offset}`,
              offset,
            );
            if (resync !== null) {
              offset = resync;
              continue;
            }
            return;
          }
          this.leftoverBuf = data.slice(offset);
          this.nextChunkFileOffset = baseOffset + offset;
        }
        return;
      }

      if (el.id === MKV_ID.Cluster) {
        // If the cluster's declared size extends past the chunk, stream its
        // complete child blocks instead of waiting for the entire Cluster.
        // Some Opus dual-audio files write very large Clusters; holding them
        // whole makes the 64 MB accumulator guard fire even though every
        // SimpleBlock inside is perfectly usable as soon as it is complete.
        //
        // Unknown-size Clusters need the same treatment. `readElement()` can
        // only clamp an unknown-size element to the current buffer, so treating
        // it as whole would drop a tail block at the buffer boundary and leave
        // the next Range response starting in the middle of payload bytes.
        if (
          el.dataLengthRaw === -1 ||
          el.dataOffset + el.dataLengthRaw > data.length
        ) {
          if (audioOnly) {
            try {
              const parsed = extractClusterSamplesFromRange(
                data,
                el.dataOffset,
                data.length,
                0,
                this.info,
              );
              this.emitClusterSamples(
                parsed.samples,
                true,
                baseOffset + el.elementOffset,
                undefined,
                {
                  audioPtsMinMs: opts.audioPtsMinMs,
                  audioPtsMaxMs: opts.audioPtsMaxMs,
                  videoPtsMinMs: opts.videoPtsMinMs,
                  videoPtsMaxMs: opts.videoPtsMaxMs,
                  updateClusterIndex: opts.updateClusterIndex,
                  randomAccessVideo: opts.randomAccessVideo,
                },
              );
              clustersThisChunk++;
              if (parsed.reachedClusterBoundary) {
                offset = parsed.consumedOffset;
                continue;
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("Audio catch-up Cluster parse error (skipping):", e);
            }
            return;
          }
          if (!updateLeftover) {
            try {
              const parsed = extractClusterSamplesFromRange(
                data,
                el.dataOffset,
                data.length,
                0,
                this.info,
              );
              this.emitClusterSamples(
                parsed.samples,
                false,
                baseOffset + el.elementOffset,
                undefined,
                {
                  audioPtsMinMs: opts.audioPtsMinMs,
                  audioPtsMaxMs: opts.audioPtsMaxMs,
                  videoPtsMinMs: opts.videoPtsMinMs,
                  videoPtsMaxMs: opts.videoPtsMaxMs,
                  updateClusterIndex: opts.updateClusterIndex,
                  randomAccessVideo: opts.randomAccessVideo,
                },
              );
              clustersThisChunk++;
              if (parsed.reachedClusterBoundary) {
                offset = parsed.consumedOffset;
                continue;
              }
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("Media catch-up Cluster parse error (skipping):", e);
            }
            return;
          }
          if (updateLeftover && !audioOnly) {
            // Bound a malformed Cluster size (declared end past EOF) so the
            // streaming child-parser stops at the real end of the file
            // instead of waiting forever for bytes that don't exist.
            const declaredEnd =
              el.dataLengthRaw === -1
                ? null
                : baseOffset + el.dataOffset + el.dataLengthRaw;
            const boundedEnd =
              declaredEnd != null &&
              this.fileSize > 0 &&
              declaredEnd > this.fileSize
                ? null // treat as unknown-size; parser will stop at next Cluster
                : declaredEnd;
            this.partialCluster = {
              clusterFileOffset: baseOffset + el.elementOffset,
              dataEndFileOffset: boundedEnd,
              clusterTimeMs: 0,
              indexed: false,
            };
            const partial = this.processPartialClusterContinuation(
              data,
              baseOffset,
              el.dataOffset,
            );
            clustersThisChunk++;
            if (partial.waitingForMore) return;
            offset = partial.nextOffset;
            continue;
          }
          return;
        }
        try {
          const samples = extractClusterSamples(data, el, this.info);
          this.emitClusterSamples(
            samples,
            audioOnly,
            baseOffset + el.elementOffset,
            undefined,
            {
              audioPtsMinMs: opts.audioPtsMinMs,
              audioPtsMaxMs: opts.audioPtsMaxMs,
              videoPtsMinMs: opts.videoPtsMinMs,
              videoPtsMaxMs: opts.videoPtsMaxMs,
              updateClusterIndex: opts.updateClusterIndex,
              randomAccessVideo: opts.randomAccessVideo,
            },
          );
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
          if (isMainStreamChunk && this.mediaSeekCatchUpActive) {
            await this.waitWhileMediaSeekCatchUpActive();
            if (this.destroyed) return;
          }
          lastYield = performance.now();
        }
      } else {
        // Sanity: an element whose declared end runs past EOF, OR whose
        // declared size dwarfs anything a real non-Cluster element would
        // hold, means the parser is misaligned (e.g. the previous Cluster's
        // declared size was wrong, or junk bytes between clusters parsed as
        // a bogus EBML header). Without this guard, `rawEnd > data.length`
        // is permanently true and `leftoverBuf` accumulates until the 64 MB
        // overflow guard kills playback. Recover by scanning forward for
        // the next Cluster signature.
        const declaredEndPastEof =
          el.dataLengthRaw !== -1 &&
          this.fileSize > 0 &&
          baseOffset + el.dataOffset + el.dataLengthRaw > this.fileSize;
        const declaredSizeImplausible =
          el.dataLengthRaw !== -1 &&
          el.dataLengthRaw > NON_CLUSTER_MAX_DECLARED_SIZE;
        if (declaredEndPastEof || declaredSizeImplausible) {
          if (!updateLeftover) return;
          const reason = declaredEndPastEof
            ? `past EOF ${this.fileSize}`
            : `> ${NON_CLUSTER_MAX_DECLARED_SIZE} sane cap`;
          const resync = this.resyncToNextClusterOrKeepTail(
            data,
            baseOffset,
            offset,
            `element id=0x${el.id.toString(16)} at file offset ` +
              `${baseOffset + offset} declares ${el.dataLengthRaw} bytes ` +
              `(${reason})`,
            offset + 1,
          );
          if (resync !== null) {
            offset = resync;
            continue;
          }
          return;
        }

        const rawEnd =
          el.dataLengthRaw === -1
            ? el.elementOffset + el.elementLength
            : el.dataOffset + el.dataLengthRaw;
        if (rawEnd > data.length) {
          if (updateLeftover) {
            this.leftoverBuf = data.slice(offset);
            this.nextChunkFileOffset = baseOffset + offset;
          }
          return;
        }
        offset = rawEnd;
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

  private resyncToNextClusterOrKeepTail(
    data: Uint8Array,
    baseOffset: number,
    offset: number,
    reason: string,
    scanStart: number,
  ): number | null {
    const resync = findFirstClusterOffset(data, scanStart, data.length);
    if (resync !== null) {
      // eslint-disable-next-line no-console
      console.warn(
        `[mse] resync: ${reason}; skipping ${resync - offset} bytes to ` +
        `next Cluster`,
      );
      return resync;
    }

    // No Cluster ID in this buffer. Keep only the trailing 3 bytes so a
    // 4-byte Cluster signature spanning the boundary can still be matched on
    // the next read — and so a random mid-payload byte sequence cannot become
    // a forever-growing "partial element" in the stream accumulator.
    const dropTo = Math.max(offset, data.length - CLUSTER_ID_TAIL_BYTES);
    this.leftoverBuf = dropTo < data.length ? data.slice(dropTo) : null;
    this.nextChunkFileOffset = baseOffset + dropTo;
    // eslint-disable-next-line no-console
    console.warn(
      `[mse] resync: ${reason}; no Cluster ID in current buffer; dropped ` +
      `${dropTo - offset} bytes (offset now ${baseOffset + dropTo})`,
    );
    return null;
  }

  private processPartialClusterContinuation(
    data: Uint8Array,
    baseOffset: number,
    startOffset = 0,
  ): { nextOffset: number; waitingForMore: boolean; completed: boolean } {
    if (!this.info || !this.partialCluster) {
      return { nextOffset: startOffset, waitingForMore: false, completed: false };
    }

    const state = this.partialCluster;
    const clusterEndInBuffer = state.dataEndFileOffset == null
      ? data.length
      : Math.max(0, Math.min(data.length, state.dataEndFileOffset - baseOffset));
    const parseEnd = Math.max(startOffset, clusterEndInBuffer);

    if (parseEnd > startOffset) {
      try {
        const parsed = extractClusterSamplesFromRange(
          data,
          startOffset,
          parseEnd,
          state.clusterTimeMs,
          this.info,
        );
        state.clusterTimeMs = parsed.clusterTimeMs;
        this.emitClusterSamples(parsed.samples, false, state.clusterFileOffset, state);

        if (parsed.reachedClusterBoundary) {
          this.partialCluster = null;
          this.leftoverBuf = null;
          this.nextChunkFileOffset = baseOffset + parsed.consumedOffset;
          return {
            nextOffset: parsed.consumedOffset,
            waitingForMore: false,
            completed: true,
          };
        }

        if (parsed.consumedOffset < parseEnd) {
          this.leftoverBuf = data.slice(parsed.consumedOffset);
          this.nextChunkFileOffset = baseOffset + parsed.consumedOffset;
          return {
            nextOffset: parsed.consumedOffset,
            waitingForMore: true,
            completed: false,
          };
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("Partial Cluster parse error (skipping):", e);
        this.partialCluster = null;
        this.leftoverBuf = null;
        this.nextChunkFileOffset = baseOffset + parseEnd;
        return { nextOffset: parseEnd, waitingForMore: false, completed: true };
      }
    }

    if (
      state.dataEndFileOffset != null &&
      baseOffset + clusterEndInBuffer >= state.dataEndFileOffset
    ) {
      this.partialCluster = null;
      this.leftoverBuf = null;
      this.nextChunkFileOffset = baseOffset + clusterEndInBuffer;
      return {
        nextOffset: clusterEndInBuffer,
        waitingForMore: false,
        completed: true,
      };
    }

    this.leftoverBuf = null;
    this.nextChunkFileOffset = baseOffset + parseEnd;
    return { nextOffset: parseEnd, waitingForMore: true, completed: false };
  }

  private recordClusterIndex(entry: ClusterIndexEntry): void {
    const existing = this.clusterIndex.find(
      (candidate) => candidate.fileOffset === entry.fileOffset,
    );
    if (existing) {
      existing.hasVideoKeyframe ||= entry.hasVideoKeyframe;
      existing.ptsMs = Math.min(existing.ptsMs, entry.ptsMs);
      return;
    }

    const insertAt = this.clusterIndex.findIndex(
      (candidate) => candidate.ptsMs > entry.ptsMs,
    );
    if (insertAt === -1) this.clusterIndex.push(entry);
    else this.clusterIndex.splice(insertAt, 0, entry);
  }

  private emitClusterSamples(
    samples: DemuxedSample[],
    audioOnly: boolean,
    clusterFileOffset: number,
    partialState?: PartialClusterState,
    opts: {
      audioPtsMinMs?: number;
      audioPtsMaxMs?: number;
      videoPtsMinMs?: number;
      videoPtsMaxMs?: number;
      updateClusterIndex?: boolean;
      randomAccessVideo?: boolean;
    } = {},
  ): void {
    if (!this.info || samples.length === 0) return;

    // Track the cluster's start PTS for catch-up lookups.
    if (!audioOnly && opts.updateClusterIndex !== false) {
      const shouldIndex = partialState ? !partialState.indexed : true;
      if (shouldIndex) {
        this.recordClusterIndex({
          fileOffset: clusterFileOffset,
          ptsMs: samples[0].pts,
          hasVideoKeyframe: samples.some((s) => s.isVideo && s.isKeyframe),
        });
        if (partialState) partialState.indexed = true;
      }
    }

    const videoSamples = samples.filter(
      (s) =>
        s.isVideo &&
        sampleOverlapsPtsWindow(s, opts.videoPtsMinMs, opts.videoPtsMaxMs),
    );
    const audioSamples = samples.filter(
      (s) =>
        !s.isVideo &&
        (this.audioEmitFilter == null ||
          s.trackNumber === this.audioEmitFilter) &&
        sampleOverlapsPtsWindow(s, opts.audioPtsMinMs, opts.audioPtsMaxMs),
    );

    if (!audioOnly && videoSamples.length > 0) {
      const normalizedVideoSamples =
        this.normalizeVideoSamplesForInitialTimeline(videoSamples);
      const baseDecodeTimeMs =
        opts.randomAccessVideo
          ? normalizedVideoSamples[0].pts
          : this.videoNextDtsMs ?? normalizedVideoSamples[0].pts;
      this.videoSeq++;
      const seg = generateVideoMediaSegment(
        normalizedVideoSamples,
        this.videoSeq,
        this.info.video,
        baseDecodeTimeMs,
      );
      if (!opts.randomAccessVideo) {
        this.videoNextDtsMs =
          baseDecodeTimeMs +
          sampleRunDurationMs(
            normalizedVideoSamples,
            this.info.video.defaultDurationNs,
            33,
          );
      }
      if (this.videoSeq === 1) markPlayback("remux:first-segment-ready");
      if (seg.length > 0) this.enqueueVideoAppend(seg);
    }

    if (this.externalAudio && audioSamples.length > 0) {
      this.externalAudio.enqueueSamples(audioSamples);
      if (
        this.audioCatchUpTargetMs > 0 &&
        this.externalAudio.bufferedUntilSec * 1000 >= this.audioCatchUpTargetMs
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

  private async prepareVideoSeekAppend(): Promise<void> {
    this.videoAppendQueue = [];
    await this.waitForUpdateEndOn(this.videoSourceBuffer);
    this.videoAppendQueue = [];
    this.videoNextDtsMs = null;
  }

  private async waitForVideoBufferedAt(
    anchorSec: number,
    shouldContinue: () => boolean,
  ): Promise<boolean> {
    const deadline = performance.now() + SEEK_VIDEO_BUFFER_WAIT_MS;
    while (
      !this.destroyed &&
      shouldContinue() &&
      performance.now() < deadline
    ) {
      if (this.isVideoBufferedAt(anchorSec)) return true;
      this.drainVideoQueue();
      if (this.videoSourceBuffer?.updating) {
        await this.waitForUpdateEndOn(this.videoSourceBuffer);
      } else {
        await sleep(50);
      }
    }
    return this.isVideoBufferedAt(anchorSec);
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
      this.initialVideoTimelineAnchored = true;
      this.initialVideoPtsOffsetMs = 0;

      if (!externalAudio) {
        const newInit = generateAudioInitSegment(newAudio);
        this.enqueueAudioAppend(newInit.data);
      }

      // Kick off the catch-up: parallel range fetch from the cluster covering
      // playhead (minus a small lookback) to the main stream's current byte
      // position. Demuxes audio for the new TrackNumber and feeds the audio
      // buffer until it catches up.
      this.startAudioCatchUp(playheadMs, "switch").catch((e) => {
        if (isAbortError(e)) return;
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

  private normalizeVideoSamplesForInitialTimeline(
    samples: DemuxedSample[],
  ): DemuxedSample[] {
    if (
      !this.normalizeInitialAudioTimeline ||
      samples.length === 0 ||
      this.audioCatchUpTargetMs > 0
    ) {
      return samples;
    }
    if (!this.shouldNormalizeInitialTimelineAtCurrentPlayhead()) {
      this.disableInitialTimelineNormalizationForActivePlayhead();
      return samples;
    }

    if (!this.initialVideoTimelineAnchored) {
      const firstPts = samples[0].pts;
      this.initialVideoPtsOffsetMs =
        firstPts >= AUDIO_TIMELINE_NORMALIZE_THRESHOLD_MS ? firstPts : 0;
      this.initialVideoTimelineAnchored = true;
      if (this.initialVideoPtsOffsetMs > 0) {
        // eslint-disable-next-line no-console
        console.info(
          `[mse] normalizing initial video timeline by ` +
          `-${(this.initialVideoPtsOffsetMs / 1000).toFixed(3)}s ` +
          `(first video cluster PTS was late — usually because resync ` +
          `skipped early clusters); audio will be shifted by the same ` +
          `amount to preserve A/V sync`,
        );
      }
    }

    if (this.initialVideoPtsOffsetMs <= 0) return samples;

    return samples.map((s) => ({
      ...s,
      pts: Math.max(0, s.pts - this.initialVideoPtsOffsetMs),
    }));
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
    if (!this.shouldNormalizeInitialTimelineAtCurrentPlayhead()) {
      this.disableInitialTimelineNormalizationForActivePlayhead();
      return samples;
    }

    if (!this.initialAudioTimelineAnchored) {
      // If video has been shifted (resync case: both tracks start late),
      // mirror its offset so audio stays in sync with video. Otherwise fall
      // back to the original "shift only if audio starts late" behavior,
      // which handles dual-audio MKVs where the secondary track's first
      // PTS is several seconds past zero while video starts at zero.
      if (
        this.initialVideoTimelineAnchored &&
        this.initialVideoPtsOffsetMs > 0
      ) {
        this.initialAudioPtsOffsetMs = this.initialVideoPtsOffsetMs;
      } else {
        const firstPts = samples[0].pts;
        this.initialAudioPtsOffsetMs =
          firstPts >= AUDIO_TIMELINE_NORMALIZE_THRESHOLD_MS ? firstPts : 0;
      }
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

  private shouldNormalizeInitialTimelineAtCurrentPlayhead(): boolean {
    const playheadMs = (this.videoElement?.currentTime ?? 0) * 1000;
    return playheadMs <= INITIAL_TIMELINE_NORMALIZE_MAX_PLAYHEAD_MS;
  }

  private disableInitialTimelineNormalizationForActivePlayhead(): void {
    if (
      this.initialVideoTimelineAnchored &&
      this.initialAudioTimelineAnchored &&
      this.initialVideoPtsOffsetMs === 0 &&
      this.initialAudioPtsOffsetMs === 0
    ) {
      return;
    }
    this.initialVideoTimelineAnchored = true;
    this.initialVideoPtsOffsetMs = 0;
    this.initialAudioTimelineAnchored = true;
    this.initialAudioPtsOffsetMs = 0;
    // eslint-disable-next-line no-console
    console.info(
      `[mse] preserving MKV timeline at active playhead ` +
      `${(this.videoElement?.currentTime ?? 0).toFixed(2)}s; ` +
      `initial normalization is only safe near 0s`,
    );
  }

  /**
   * Side range-fetch that backfills audio between `playheadMs` and the main
   * stream's current byte position so a swap doesn't leave a silent gap.
   * Uses the cluster index built by the main stream to map PTS → byte
   * offset; falls back to the latest indexed cluster when no earlier match
   * exists.
   */
  private async startMediaSeekCatchUp(
    playheadMs: number,
    serial: number,
  ): Promise<void> {
    if (!this.info) return;
    if (this.clusterIndex.length === 0) return;

    const lookbackMs = 500;
    const targetMs = Math.max(0, playheadMs - lookbackMs);
    let pickIndex = 0;
    let pick = this.clusterIndex[0];
    for (let i = 0; i < this.clusterIndex.length; i++) {
      const e = this.clusterIndex[i];
      if (e.ptsMs <= targetMs) pick = e;
      else break;
      pickIndex = i;
    }

    let mediaPick = pick;
    let mediaPickIndex = pickIndex;
    for (let i = pickIndex; i >= 0; i--) {
      const e = this.clusterIndex[i];
      if (e.hasVideoKeyframe) {
        mediaPick = e;
        mediaPickIndex = i;
        break;
      }
    }

    const startOffset = mediaPick.fileOffset;
    const desiredEndMs = playheadMs + SEEK_MEDIA_CATCH_UP_AHEAD_MS;
    const endByTime = this.clusterIndex
      .slice(mediaPickIndex + 1)
      .find((e) => e.ptsMs >= desiredEndMs)?.fileOffset;
    const endByBytes = startOffset + SEEK_MEDIA_CATCH_UP_MAX_BYTES;
    const endOffset = Math.min(
      Math.max(startOffset, this.fetchOffset),
      endByTime ?? Number.POSITIVE_INFINITY,
      endByBytes,
      this.fileSize,
    );
    if (endOffset <= startOffset) return;

    if (this.audioCatchUpAbort) {
      try { this.audioCatchUpAbort.abort(); } catch { /* ignore */ }
      this.audioCatchUpAbort = null;
    }
    this.mediaSeekCatchUpActive = true;

    // Old forward-stream appends can be many minutes ahead of a backward seek.
    // Drop queued-but-not-yet-appended video so the target window reaches MSE
    // before the browser gives up waiting at the new playhead.
    this.videoAppendQueue = [];

    const catchUpAbort = new AbortController();
    this.audioCatchUpAbort = catchUpAbort;
    const linkedSignal = catchUpAbort.signal;
    const shouldContinue = () =>
      !this.destroyed &&
      !linkedSignal.aborted &&
      this.audioCatchUpSerial === serial;
    try {
      if (!shouldContinue()) return;
      const { buf: data } = await this.fetchRange(startOffset, endOffset - 1, linkedSignal);
      if (!shouldContinue()) return;

      // eslint-disable-next-line no-console
      console.info(
        `[mse] media catch-up (seek): ` +
        `${((endOffset - startOffset) / 1024 / 1024).toFixed(2)} MB ` +
        `from cluster@pts=${(mediaPick.ptsMs / 1000).toFixed(2)}s` +
        `${mediaPick.hasVideoKeyframe ? "" : " (no earlier keyframe indexed)"}`,
      );

      await this.prepareVideoSeekAppend();
      if (!shouldContinue()) return;

      await this.processChunk(data, {
        audioOnly: false,
        chunkBaseFileOffset: startOffset,
        updateLeftover: false,
        shouldContinue,
        suppressRawChunk: true,
        updateClusterIndex: false,
        randomAccessVideo: true,
        audioPtsMinMs: targetMs,
        audioPtsMaxMs: desiredEndMs,
        videoPtsMinMs: Math.max(0, mediaPick.ptsMs - 250),
        videoPtsMaxMs: desiredEndMs,
      });
      if (shouldContinue()) {
        const ready = await this.waitForVideoBufferedAt(
          playheadMs / 1000,
          shouldContinue,
        );
        if (!ready) {
          // eslint-disable-next-line no-console
          console.warn(
            `[mse] media catch-up appended but target ` +
            `${(playheadMs / 1000).toFixed(2)}s is still not video-buffered`,
          );
          return;
        }
        this.requestStreamRestart(endOffset);
      }
    } catch (e) {
      if (!isAbortError(e)) throw e;
    } finally {
      if (this.audioCatchUpAbort === catchUpAbort) {
        this.audioCatchUpAbort = null;
      }
      if (this.audioCatchUpSerial === serial) {
        this.mediaSeekCatchUpActive = false;
      }
    }
  }

  private async startAudioCatchUp(
    playheadMs: number,
    reason: "switch" | "seek" = "switch",
    serial?: number,
  ): Promise<void> {
    if (!this.info) return;
    if (this.clusterIndex.length === 0) return;

    // Find the latest cluster index entry whose pts ≤ playheadMs - lookback.
    // 500 ms of lookback gives the FLAC/AAC decoder time to lock before
    // hitting the playhead even if the cluster doesn't start exactly there.
    const lookbackMs = 500;
    const targetMs = Math.max(0, playheadMs - lookbackMs);
    let pickIndex = 0;
    let pick = this.clusterIndex[0];
    for (let i = 0; i < this.clusterIndex.length; i++) {
      const e = this.clusterIndex[i];
      if (e.ptsMs <= targetMs) pick = e;
      else break;
      pickIndex = i;
    }
    const startOffset = pick.fileOffset;
    let endOffset = Math.max(startOffset, this.fetchOffset);
    const audioPtsMinMs = targetMs;
    let audioPtsMaxMs: number | undefined;
    if (reason === "seek") {
      const desiredEndMs = playheadMs + SEEK_AUDIO_CATCH_UP_AHEAD_MS;
      audioPtsMaxMs = desiredEndMs;
      const endByTime = this.clusterIndex
        .slice(pickIndex + 1)
        .find((e) => e.ptsMs >= desiredEndMs)?.fileOffset;
      const endByBytes = startOffset + SEEK_AUDIO_CATCH_UP_MAX_BYTES;
      endOffset = Math.min(
        Math.max(startOffset, this.fetchOffset),
        endByTime ?? Number.POSITIVE_INFINITY,
        endByBytes,
        this.fileSize,
      );
    }
    if (endOffset <= startOffset) return;

    if (this.audioCatchUpAbort) {
      try { this.audioCatchUpAbort.abort(); } catch { /* ignore */ }
      this.audioCatchUpAbort = null;
    }

    const catchUpAbort = new AbortController();
    this.audioCatchUpAbort = catchUpAbort;
    const linkedSignal = catchUpAbort.signal;
    const catchUpSerial = serial ?? ++this.audioCatchUpSerial;
    const shouldContinue = () =>
      !this.destroyed &&
      !linkedSignal.aborted &&
      this.audioCatchUpSerial === catchUpSerial;
    try {
      if (!shouldContinue()) return;
      const { buf: data } = await this.fetchRange(startOffset, endOffset - 1, linkedSignal);
      if (!shouldContinue()) return;

      // eslint-disable-next-line no-console
      console.info(
        `[mse] audio catch-up (${reason}): ` +
        `${((endOffset - startOffset) / 1024 / 1024).toFixed(2)} MB ` +
        `from cluster@pts=${(pick.ptsMs / 1000).toFixed(2)}s`,
      );

      // Demux audio-only out of the fetched window. Do NOT touch
      // nextChunkFileOffset / leftoverBuf — those belong to the main stream.
      await this.processChunk(data, {
        audioOnly: true,
        chunkBaseFileOffset: startOffset,
        updateLeftover: false,
        shouldContinue,
        audioPtsMinMs,
        audioPtsMaxMs,
      });
    } catch (e) {
      if (!isAbortError(e)) throw e;
    } finally {
      if (this.audioCatchUpAbort === catchUpAbort) {
        this.audioCatchUpAbort = null;
      }
    }
  }

  private describeAccumulationState(
    accumulated: Uint8Array | null,
    incoming: Uint8Array,
  ): string {
    const pendingBytes = accumulated?.length ?? 0;
    const partial = this.partialCluster;
    const partialText = partial
      ? `partialCluster{cluster@${partial.clusterFileOffset}, ` +
        `end=${partial.dataEndFileOffset ?? "unknown"}, ` +
        `time=${partial.clusterTimeMs.toFixed(1)}ms, indexed=${partial.indexed}}`
      : "partialCluster=none";
    const head = accumulated
      ? formatHex(accumulated.subarray(0, Math.min(12, accumulated.length)))
      : "";
    const tail = accumulated
      ? formatHex(accumulated.subarray(Math.max(0, accumulated.length - 12)))
      : "";
    return (
      `pending=${(pendingBytes / 1024 / 1024).toFixed(2)}MB ` +
      `incoming=${(incoming.length / 1024).toFixed(1)}KB ` +
      `fetchOffset=${this.fetchOffset} nextChunk=${this.nextChunkFileOffset} ` +
      `${partialText} pendingHead=[${head}] pendingTail=[${tail}]`
    );
  }

  // -------------------------------------------------------------------------
  // Network — used only for the initial header fetch
  // -------------------------------------------------------------------------

  private async fetchRange(
    start: number,
    end: number,
    signal?: AbortSignal,
  ): Promise<{ buf: Uint8Array; total: number }> {
    const linkedSignal = signal ?? this.abortController?.signal;
    if (this.byteSource) {
      const { bytes, total } = await this.byteSource.readRange(start, end, linkedSignal);
      return { buf: bytes, total };
    }
    const url = buildMediaUrl(this.fileId);
    // Retries (429/5xx/network) and backoff live in DriveRequestQueue now.
    // Header fetch is "critical" because nothing else can start until it
    // returns — the MediaSource has no init segment without it.
    const res = await authedFetch(
      url,
      {
        headers: { Range: `bytes=${start}-${end}` },
        signal: linkedSignal,
      },
      {
        kind: "media-range",
        priority: "critical",
        signal: linkedSignal,
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

  /**
   * Open a stream of the remaining bytes from `offset` through EOF. For
   * Drive, a single open-ended Range request; for local files, delegates to
   * `byteSource.openStream` (`File.slice().stream()`, never null). Falls back
   * to a one-shot reader over the full response body on the rare WebView that
   * doesn't expose a readable stream on `Response.body`.
   */
  private async openByteStream(offset: number): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    if (this.byteSource) {
      return this.byteSource.openStream(offset, this.abortController?.signal);
    }
    const url = buildMediaUrl(this.fileId);
    const res = await authedFetch(
      url,
      {
        headers: { Range: `bytes=${offset}-` },
        signal: this.abortController?.signal,
      },
      {
        kind: "media-stream",
        priority: "critical",
        signal: this.abortController?.signal,
      },
    );
    const reader = res.body?.getReader();
    if (reader) return reader;
    const ab = await res.arrayBuffer();
    return singleChunkReader(new Uint8Array(ab));
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wraps a single already-fetched buffer in a one-shot reader so a streaming
 *  consumer (`progressiveStream`) can treat it like any other chunked read. */
function singleChunkReader(data: Uint8Array): ReadableStreamDefaultReader<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  }).getReader();
}

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

function sampleRunDurationMs(
  samples: DemuxedSample[],
  defaultDurNs: number,
  fallbackMs: number,
): number {
  const defaultMs = defaultDurNs > 0 ? defaultDurNs / 1_000_000 : 0;
  let total = 0;
  for (const sample of samples) {
    total += sample.duration > 0 ? sample.duration : defaultMs || fallbackMs;
  }
  return total;
}

function sampleOverlapsPtsWindow(
  sample: DemuxedSample,
  minMs?: number,
  maxMs?: number,
): boolean {
  const durationMs = sample.duration > 0 ? sample.duration : 0;
  const endMs = sample.pts + durationMs;
  if (minMs != null && endMs < minMs) return false;
  if (maxMs != null && sample.pts > maxMs) return false;
  return true;
}

function formatByteCount(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

function formatHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join(" ");
}

function isAbortError(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const name = "name" in e ? (e as { name?: unknown }).name : "";
  return name === "AbortError";
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
