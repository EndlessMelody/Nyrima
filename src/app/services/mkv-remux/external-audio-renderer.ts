/**
 * External MKV audio renderer.
 *
 * This is the browser-shaped version of VLC's track model: video remains in
 * the MSE pipeline, while the selected audio track is decoded independently
 * and clocked against the <video> element's currentTime.
 *
 * FLAC uses WebCodecs when the platform exposes it. AC-3 uses a compact WASM
 * decoder because Chromium often rejects Dolby Digital in WebCodecs even when
 * native MKV playback can handle the file's default track.
 */

import { Ac3WasmDecoder, type DecodedPcmAudio } from "./ac3-wasm-decoder";
import type { AudioTrackInfo, DemuxedSample } from "./types";

type AudioDecoderState = "unconfigured" | "configured" | "closed";

interface AudioDecoderConfigLike {
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  description?: BufferSource;
}

interface AudioDecoderSupportLike {
  supported?: boolean;
}

interface EncodedAudioChunkLike {
  // Opaque WebCodecs object.
}

interface EncodedAudioChunkConstructorLike {
  new(init: {
    type: "key" | "delta";
    timestamp: number;
    duration?: number;
    data: BufferSource;
  }): EncodedAudioChunkLike;
}

interface AudioDataCopyOptionsLike {
  planeIndex: number;
  format: "f32-planar";
}

interface DecodedAudioDataLike {
  readonly timestamp: number;
  readonly duration: number | null;
  readonly sampleRate: number;
  readonly numberOfFrames: number;
  readonly numberOfChannels: number;
  copyTo(
    destination: AllowSharedBufferSource,
    options: AudioDataCopyOptionsLike,
  ): void;
  close(): void;
}

interface AudioDecoderLike {
  readonly state: AudioDecoderState;
  readonly decodeQueueSize: number;
  configure(config: AudioDecoderConfigLike): void;
  decode(chunk: EncodedAudioChunkLike): void;
  flush(): Promise<void>;
  reset(): void;
  close(): void;
}

interface AudioDecoderConstructorLike {
  new(init: {
    output: (data: DecodedAudioDataLike) => void;
    error: (error: DOMException) => void;
  }): AudioDecoderLike;
  isConfigSupported?(
    config: AudioDecoderConfigLike,
  ): Promise<AudioDecoderSupportLike>;
}

const MAX_DECODE_QUEUE = 160;
const MAX_SCHEDULE_AHEAD_SEC = 40;
const AC3_SCHEDULE_WINDOW_SLEEP_MS = 250;
const MAX_LATE_START_SEC = 0.75;
const RANGE_MERGE_EPSILON_SEC = 0.05;
const RANGE_ANCHOR_TOLERANCE_SEC = 0.25;
const TIMESTAMP_REPAIR_MAX_OVERLAP_SEC = 2;
const AC3_STALE_SAMPLE_BEHIND_SEC = 5;

interface AudioRange {
  startSec: number;
  endSec: number;
}

interface ScheduledAudioSource extends AudioRange {
  source: AudioBufferSourceNode;
}

export class ExternalMkvAudioRenderer {
  private audio: AudioTrackInfo;
  private readonly video: HTMLVideoElement;
  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private decoder: AudioDecoderLike | null = null;
  private decoderConfig: AudioDecoderConfigLike | null = null;
  private ac3Decoder: Ac3WasmDecoder | null = null;
  private ac3DecodeChain: Promise<void> = Promise.resolve();
  private ac3DecodeQueueSize = 0;
  private ac3PendingSamples: DemuxedSample[] = [];
  private ac3ActiveSample: DemuxedSample | null = null;
  private ac3DrainScheduled = false;
  private ac3DrainTimer: number | null = null;
  private ac3Epoch = 0;
  private scheduled: ScheduledAudioSource[] = [];
  private lastDecodedStartSec: number | null = null;
  private lastScheduledEndSec = 0;
  private lastScheduledWebTime = 0;
  private loggedTimestampRepair = false;
  private loggedFirstEnqueue = false;
  private loggedFirstSchedule = false;
  private closed = false;
  private lastResumeAttempt = 0;
  private readonly cleanups: Array<() => void> = [];

  static async isSupported(audio: AudioTrackInfo): Promise<boolean> {
    if (audio.codec === "ac3") return true;

    const configs = buildDecoderConfigs(audio);
    if (configs.length === 0) return false;
    const { AudioDecoder } = getWebCodecs();
    if (!AudioDecoder) return false;

    if (!AudioDecoder.isConfigSupported) return true;

    for (const config of configs) {
      try {
        const support = await AudioDecoder.isConfigSupported(config);
        if (support.supported === true) return true;
      } catch {
        // Try the next spelling. AC-3 support, where present, varies by
        // platform codec registry naming.
      }
    }
    return false;
  }

  constructor(audio: AudioTrackInfo, video: HTMLVideoElement) {
    this.audio = audio;
    this.video = video;
    this.ctx = new AudioContext({
      sampleRate: audio.sampleRate || undefined,
      latencyHint: "playback",
    });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    if (audio.codec === "ac3") {
      this.ac3Decoder = new Ac3WasmDecoder(audio);
      void this.ac3Decoder.ready.then(() => {
        // eslint-disable-next-line no-console
        console.info(
          `[external-audio] AC-3 WASM decoder ready for track #${audio.trackNumber}`,
        );
      }).catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[external-audio] AC-3 WASM decoder init failed:", e);
      });
    } else {
      const { AudioDecoder } = getWebCodecs();
      if (!AudioDecoder) {
        throw new Error("WebCodecs AudioDecoder is not available.");
      }
      this.decoder = this.createDecoder(AudioDecoder, audio);
    }
    this.installVideoClockHooks();
    this.syncGain();

    // eslint-disable-next-line no-console
    console.info(
      `[external-audio] renderer ready for track #${audio.trackNumber} ` +
      `(${audio.codec}, ${audio.channels}ch @ ${audio.sampleRate}Hz, ` +
      `${this.ac3Decoder ? "wasm" : "webcodecs"}); ` +
      `ctx=${this.ctx.state}`,
    );
  }

  get bufferedUntilSec(): number {
    this.pruneOldRanges();
    return this.getContinuousBufferedEnd(this.video.currentTime);
  }

  async switchTrack(audio: AudioTrackInfo): Promise<void> {
    if (audio.codec !== "ac3" && buildDecoderConfigs(audio).length === 0) {
      throw new Error(`External audio does not support ${audio.codec}.`);
    }
    const supported = await ExternalMkvAudioRenderer.isSupported(audio);
    if (!supported) {
      throw new Error(`WebCodecs does not support this ${audio.codec} track.`);
    }

    this.stopScheduled();
    this.ac3DecodeChain = Promise.resolve();
    this.ac3DecodeQueueSize = 0;
    this.ac3PendingSamples = [];
    this.ac3ActiveSample = null;
    this.ac3DrainScheduled = false;
    this.ac3Decoder?.close();
    this.ac3Decoder = null;
    try {
      this.decoder?.close();
    } catch {
      // ignore
    }
    this.decoder = null;
    this.audio = audio;
    if (audio.codec === "ac3") {
      this.ac3Decoder = new Ac3WasmDecoder(audio);
      await this.ac3Decoder.ready;
    } else {
      const { AudioDecoder } = getWebCodecs();
      if (!AudioDecoder) {
        throw new Error("WebCodecs AudioDecoder is not available.");
      }
      this.decoder = this.createDecoder(AudioDecoder, audio);
    }
    this.loggedFirstEnqueue = false;
    this.loggedFirstSchedule = false;
  }

  enqueueSamples(samples: DemuxedSample[]): void {
    if (this.closed) return;
    if (this.ac3Decoder) {
      this.enqueueAc3Samples(samples);
      return;
    }
    if (!this.decoder || this.decoder.state !== "configured") return;

    let enqueued = 0;
    let firstPts = 0;
    let lastPts = 0;
    for (const sample of samples) {
      if (sample.isVideo || sample.trackNumber !== this.audio.trackNumber) {
        continue;
      }

      // Keep decode pressure bounded. The stream throttler keeps media around
      // 30s ahead, so this should only trip on pathological bursts.
      if (this.decoder.decodeQueueSize > MAX_DECODE_QUEUE) break;

      try {
        const chunk = newWebEncodedAudioChunk({
          type: "key",
          timestamp: Math.max(0, Math.round(sample.pts * 1000)),
          duration:
            sample.duration > 0 ? Math.round(sample.duration * 1000) : undefined,
          data: copyToArrayBuffer(sample.data),
        });
        this.decoder.decode(chunk);
        if (enqueued === 0) firstPts = sample.pts;
        lastPts = sample.pts;
        enqueued++;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[external-audio] decode enqueue failed:", e);
      }
    }

    if (enqueued > 0 && !this.loggedFirstEnqueue) {
      this.loggedFirstEnqueue = true;
      // eslint-disable-next-line no-console
      console.info(
        `[external-audio] enqueued track #${this.audio.trackNumber}: ` +
        `${enqueued} samples ${fmtSec(firstPts / 1000)}-` +
        `${fmtSec(lastPts / 1000)} queue=${this.decoder.decodeQueueSize}`,
      );
    }
  }

  private enqueueAc3Samples(samples: DemuxedSample[]): void {
    let firstPts = 0;
    let lastPts = 0;
    let queued = 0;
    for (const sample of samples) {
      if (sample.isVideo || sample.trackNumber !== this.audio.trackNumber) {
        continue;
      }
      if (queued === 0) firstPts = sample.pts;
      lastPts = sample.pts;
      // Keep overflow frames for the drain loop; dropping them creates
      // audible holes whenever one MKV chunk contains more than a few seconds.
      this.ac3PendingSamples.push({
        ...sample,
        data: sample.data.slice(),
      });
      queued++;
    }
    if (queued === 0) return;

    this.updateAc3DecodeQueueSize();
    this.scheduleAc3Drain();

    if (!this.loggedFirstEnqueue) {
      this.loggedFirstEnqueue = true;
      // eslint-disable-next-line no-console
      console.info(
        `[external-audio] enqueued AC-3 track #${this.audio.trackNumber}: ` +
        `${queued} samples ${fmtSec(firstPts / 1000)}-` +
        `${fmtSec(lastPts / 1000)} queue=${this.ac3DecodeQueueSize}`,
      );
    }
  }

  private scheduleAc3Drain(): void {
    const decoder = this.ac3Decoder;
    if (!decoder || this.ac3DrainScheduled) return;
    if (this.ac3DrainTimer !== null) {
      window.clearTimeout(this.ac3DrainTimer);
      this.ac3DrainTimer = null;
    }

    const epoch = this.ac3Epoch;
    this.ac3DrainScheduled = true;
    this.ac3DecodeChain = this.ac3DecodeChain
      .then(() => this.drainAc3Queue(decoder, epoch))
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.warn("[external-audio] AC-3 decode queue failed:", e);
      })
      .finally(() => {
        if (this.ac3Decoder === decoder && this.ac3Epoch === epoch) {
          this.ac3DrainScheduled = false;
          this.updateAc3DecodeQueueSize();
          if (this.ac3PendingSamples.length > 0) {
            if (this.hasAc3SampleInsideScheduleWindow()) {
              this.scheduleAc3Drain();
            } else if (this.ac3DrainTimer === null) {
              this.ac3DrainTimer = window.setTimeout(() => {
                this.ac3DrainTimer = null;
                this.scheduleAc3Drain();
              }, AC3_SCHEDULE_WINDOW_SLEEP_MS);
            }
          }
        }
      });
  }

  private async drainAc3Queue(
    decoder: Ac3WasmDecoder,
    epoch: number,
  ): Promise<void> {
    while (
      !this.closed &&
      this.ac3Decoder === decoder &&
      this.ac3Epoch === epoch
    ) {
      const sample = this.takeNextAc3SampleInsideScheduleWindow();
      if (!sample) break;

      this.ac3ActiveSample = sample;
      this.updateAc3DecodeQueueSize();
      try {
        const decoded = await decoder.decode(sample);
        if (
          decoded &&
          this.ac3Decoder === decoder &&
          this.ac3Epoch === epoch
        ) {
          this.scheduleDecodedPcm(decoded);
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[external-audio] AC-3 WASM decode failed:", e);
      } finally {
        if (this.ac3ActiveSample === sample) {
          this.ac3ActiveSample = null;
        }
        this.updateAc3DecodeQueueSize();
      }
    }
  }

  flush(): Promise<void> {
    if (this.closed) {
      return Promise.resolve();
    }
    if (this.ac3Decoder) {
      return this.ac3DecodeChain
        .then(() => this.ac3Decoder?.flush())
        .then(() => undefined)
        .catch((e) => {
          // eslint-disable-next-line no-console
          console.warn("[external-audio] AC-3 decoder flush failed:", e);
        });
    }
    if (!this.decoder || this.decoder.state !== "configured") {
      return Promise.resolve();
    }
    return this.decoder.flush().catch((e) => {
      // eslint-disable-next-line no-console
      console.warn("[external-audio] decoder flush failed:", e);
    });
  }

  close(): void {
    this.closed = true;
    for (const cleanup of this.cleanups.splice(0)) {
      try {
        cleanup();
      } catch {
        // ignore
      }
    }
    this.stopScheduled();
    this.ac3Decoder?.close();
    try {
      this.decoder?.close();
    } catch {
      // ignore
    }
    void this.ctx.close().catch(() => undefined);
  }

  private createDecoder(
    AudioDecoder: AudioDecoderConstructorLike,
    audio: AudioTrackInfo,
  ): AudioDecoderLike {
    const configs = buildDecoderConfigs(audio);
    if (configs.length === 0) {
      throw new Error(`External audio does not support ${audio.codec}.`);
    }
    let lastError: unknown = null;
    for (const config of configs) {
      const decoder = new AudioDecoder({
        output: (data) => this.handleDecodedAudio(data),
        error: (error) => {
          // eslint-disable-next-line no-console
          console.warn("[external-audio] decoder error:", error);
        },
      });
      try {
        decoder.configure(config);
        // eslint-disable-next-line no-console
        console.info(
          `[external-audio] configured WebCodecs decoder codec=${config.codec}`,
        );
        this.decoderConfig = config;
        return decoder;
      } catch (e) {
        lastError = e;
        try {
          decoder.close();
        } catch {
          // ignore
        }
      }
    }

    const tried = configs.map((config) => config.codec).join(", ");
    throw new Error(
      `WebCodecs could not configure ${audio.codec} decoder. ` +
      `Tried: ${tried}. Last error: ${String(lastError)}`,
    );
  }

  private handleDecodedAudio(data: DecodedAudioDataLike): void {
    if (this.closed) {
      data.close();
      return;
    }

    if (
      this.ctx.state === "suspended" &&
      !this.video.paused &&
      !this.video.seeking &&
      this.video.readyState >= 3
    ) {
      const now = performance.now();
      if (now - this.lastResumeAttempt > 2000) {
        this.lastResumeAttempt = now;
        this.resumeContext("schedule-active");
      }
    }

    try {
      const decodedStartSec = data.timestamp / 1_000_000;
      const mediaDurationSec =
        (data.duration ?? 0) > 0
          ? (data.duration ?? 0) / 1_000_000
          : data.numberOfFrames / data.sampleRate;
      let mediaStartSec = decodedStartSec;
      const jumpedBack =
        this.lastDecodedStartSec != null &&
        decodedStartSec + TIMESTAMP_REPAIR_MAX_OVERLAP_SEC <
          this.lastDecodedStartSec;
      if (jumpedBack) {
        this.lastScheduledEndSec = 0;
        this.lastScheduledWebTime = 0;
      }

      // Audio in Matroska is commonly EBML-laced. When the MKV track does not
      // carry DefaultDuration, each frame from a laced SimpleBlock can arrive
      // with the same block timestamp. MSE can infer progression from frame
      // headers; external Web Audio scheduling cannot. Repair flat or
      // overlapping timestamps by treating decoded output as a continuous
      // stream until a real gap/seek appears.
      if (
        this.lastScheduledEndSec > 0 &&
        !jumpedBack &&
        decodedStartSec <= this.lastScheduledEndSec + 0.01 &&
        this.lastScheduledEndSec - decodedStartSec <=
          TIMESTAMP_REPAIR_MAX_OVERLAP_SEC
      ) {
        if (
          !this.loggedTimestampRepair &&
          decodedStartSec + 0.01 < this.lastScheduledEndSec
        ) {
          this.loggedTimestampRepair = true;
          // eslint-disable-next-line no-console
          console.info(
            "[external-audio] repairing flat/overlapping audio timestamps " +
            "with continuous scheduling",
          );
        }
        mediaStartSec = this.lastScheduledEndSec;
      }

      const rate = Math.max(0.1, this.video.playbackRate || 1);
      const expectedWhen = this.ctx.currentTime + (mediaStartSec - this.video.currentTime) / rate;
      const isContiguous =
        this.lastScheduledWebTime > 0 &&
        Math.abs(mediaStartSec - this.lastScheduledEndSec) < 0.1 &&
        Math.abs(this.lastScheduledWebTime - expectedWhen) < 0.15;
      let when = isContiguous ? this.lastScheduledWebTime : expectedWhen;

      const mediaEndSec = mediaStartSec + mediaDurationSec;
      this.rememberDecodePosition(decodedStartSec, mediaEndSec);

      if (this.isRangeCovered(mediaStartSec, mediaEndSec)) {
        data.close();
        return;
      }

      if (mediaStartSec - this.video.currentTime > MAX_SCHEDULE_AHEAD_SEC) {
        data.close();
        return;
      }

      const audioBuffer = this.ctx.createBuffer(
        data.numberOfChannels,
        data.numberOfFrames,
        data.sampleRate,
      );
      for (let ch = 0; ch < data.numberOfChannels; ch++) {
        data.copyTo(audioBuffer.getChannelData(ch), {
          planeIndex: ch,
          format: "f32-planar",
        });
      }

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = rate;
      source.connect(this.gain);

      let offset = 0;
      if (when < this.ctx.currentTime) {
        const lateSec = (this.ctx.currentTime - when) * rate;
        if (lateSec > mediaDurationSec || lateSec > MAX_LATE_START_SEC) {
          this.lastScheduledWebTime = 0;
          data.close();
          return;
        }
        offset = lateSec;
        when = this.ctx.currentTime;
      }

      source.onended = () => {
        this.scheduled = this.scheduled.filter((s) => s.source !== source);
      };
      this.scheduled.push({ source, startSec: mediaStartSec, endSec: mediaEndSec });
      source.start(when, offset);
      this.lastScheduledWebTime = when + (mediaDurationSec - offset) / rate;

      if (!this.loggedFirstSchedule) {
        this.loggedFirstSchedule = true;
        // eslint-disable-next-line no-console
        console.info(
          `[external-audio] scheduled first PCM for track #${this.audio.trackNumber}: ` +
          `${fmtSec(mediaStartSec)}-${fmtSec(mediaEndSec)} ` +
          `video=${fmtSec(this.video.currentTime)} ctx=${this.ctx.state}`,
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[external-audio] scheduling failed:", e);
    } finally {
      data.close();
    }
  }

  private scheduleDecodedPcm(decoded: DecodedPcmAudio): void {
    if (this.closed) return;

    if (
      this.ctx.state === "suspended" &&
      !this.video.paused &&
      !this.video.seeking &&
      this.video.readyState >= 3
    ) {
      const now = performance.now();
      if (now - this.lastResumeAttempt > 2000) {
        this.lastResumeAttempt = now;
        this.resumeContext("schedule-active");
      }
    }

    try {
      const decodedStartSec = decoded.timestampSec;
      const mediaDurationSec = decoded.durationSec;
      let mediaStartSec = decodedStartSec;
      const jumpedBack =
        this.lastDecodedStartSec != null &&
        decodedStartSec + TIMESTAMP_REPAIR_MAX_OVERLAP_SEC <
          this.lastDecodedStartSec;
      if (jumpedBack) {
        this.lastScheduledEndSec = 0;
        this.lastScheduledWebTime = 0;
      }

      if (
        this.lastScheduledEndSec > 0 &&
        !jumpedBack &&
        decodedStartSec <= this.lastScheduledEndSec + 0.01 &&
        this.lastScheduledEndSec - decodedStartSec <=
          TIMESTAMP_REPAIR_MAX_OVERLAP_SEC
      ) {
        if (
          !this.loggedTimestampRepair &&
          decodedStartSec + 0.01 < this.lastScheduledEndSec
        ) {
          this.loggedTimestampRepair = true;
          // eslint-disable-next-line no-console
          console.info(
            "[external-audio] repairing flat/overlapping audio timestamps " +
            "with continuous scheduling",
          );
        }
        mediaStartSec = this.lastScheduledEndSec;
      }

      const rate = Math.max(0.1, this.video.playbackRate || 1);
      const expectedWhen = this.ctx.currentTime + (mediaStartSec - this.video.currentTime) / rate;
      const isContiguous =
        this.lastScheduledWebTime > 0 &&
        Math.abs(mediaStartSec - this.lastScheduledEndSec) < 0.1 &&
        Math.abs(this.lastScheduledWebTime - expectedWhen) < 0.15;
      let when = isContiguous ? this.lastScheduledWebTime : expectedWhen;

      const mediaEndSec = mediaStartSec + mediaDurationSec;
      this.rememberDecodePosition(decodedStartSec, mediaEndSec);

      if (this.isRangeCovered(mediaStartSec, mediaEndSec)) return;
      if (mediaStartSec - this.video.currentTime > MAX_SCHEDULE_AHEAD_SEC) {
        return;
      }

      const audioBuffer = this.ctx.createBuffer(
        decoded.numberOfChannels,
        decoded.numberOfFrames,
        decoded.sampleRate,
      );
      for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
        audioBuffer.getChannelData(ch).set(decoded.planes[ch]);
      }

      const source = this.ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.playbackRate.value = rate;
      source.connect(this.gain);

      let offset = 0;
      if (when < this.ctx.currentTime) {
        const lateSec = (this.ctx.currentTime - when) * rate;
        if (lateSec > mediaDurationSec || lateSec > MAX_LATE_START_SEC) {
          this.lastScheduledWebTime = 0;
          return;
        }
        offset = lateSec;
        when = this.ctx.currentTime;
      }

      source.onended = () => {
        this.scheduled = this.scheduled.filter((s) => s.source !== source);
      };
      this.scheduled.push({ source, startSec: mediaStartSec, endSec: mediaEndSec });
      source.start(when, offset);
      this.lastScheduledWebTime = when + (mediaDurationSec - offset) / rate;

      if (!this.loggedFirstSchedule) {
        this.loggedFirstSchedule = true;
        // eslint-disable-next-line no-console
        console.info(
          `[external-audio] scheduled first PCM for track #${this.audio.trackNumber}: ` +
          `${fmtSec(mediaStartSec)}-${fmtSec(mediaEndSec)} ` +
          `video=${fmtSec(this.video.currentTime)} ctx=${this.ctx.state}`,
        );
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn("[external-audio] AC-3 scheduling failed:", e);
    }
  }

  private installVideoClockHooks(): void {
    const syncGain = () => this.syncGain();
    const resume = () => {
      this.syncGain();
      this.resumeContext("video-play");
    };
    const suspend = () => {
      void this.ctx.suspend().catch(() => undefined);
    };
    const reset = () => {
      this.stopScheduled();
      this.resetDecoderAfterDiscontinuity();
      if (this.decoder?.state === "configured") {
        try {
          this.decoder.reset();
          if (this.decoderConfig) {
            this.decoder.configure(this.decoderConfig);
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[external-audio] decoder reset failed:", e);
        }
      }
    };
    const recover = () => {
      this.syncGain();
      if (!this.video.paused) {
        this.resumeContext("video-clock-recovered");
      }
      if (this.ac3PendingSamples.length > 0) {
        this.scheduleAc3Drain();
      }
    };

    this.video.addEventListener("play", resume);
    this.video.addEventListener("playing", resume);
    this.video.addEventListener("pause", suspend);
    this.video.addEventListener("waiting", suspend);
    this.video.addEventListener("stalled", suspend);
    this.video.addEventListener("volumechange", syncGain);
    this.video.addEventListener("ratechange", reset);
    this.video.addEventListener("seeking", reset);
    this.video.addEventListener("emptied", reset);
    this.video.addEventListener("seeked", recover);
    this.video.addEventListener("canplay", recover);
    this.video.addEventListener("ended", suspend);

    this.cleanups.push(() => {
      this.video.removeEventListener("play", resume);
      this.video.removeEventListener("playing", resume);
      this.video.removeEventListener("pause", suspend);
      this.video.removeEventListener("waiting", suspend);
      this.video.removeEventListener("stalled", suspend);
      this.video.removeEventListener("volumechange", syncGain);
      this.video.removeEventListener("ratechange", reset);
      this.video.removeEventListener("seeking", reset);
      this.video.removeEventListener("emptied", reset);
      this.video.removeEventListener("seeked", recover);
      this.video.removeEventListener("canplay", recover);
      this.video.removeEventListener("ended", suspend);
    });

    if (this.video.paused) {
      void this.ctx.suspend().catch(() => undefined);
    } else {
      this.resumeContext("initial-playing");
    }
  }

  private resumeContext(reason: string): void {
    const before = this.ctx.state;
    void this.ctx.resume().then(() => {
      if (before !== "running") {
        // eslint-disable-next-line no-console
        console.info(
          `[external-audio] AudioContext resume (${reason}): ` +
          `${before} -> ${this.ctx.state}`,
        );
      }
    }).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn(
        `[external-audio] AudioContext resume failed (${reason}):`,
        e,
        `state=${this.ctx.state}`,
      );
    });
  }

  private syncGain(): void {
    this.gain.gain.value = this.video.muted ? 0 : this.video.volume;
  }

  private stopScheduled(): void {
    for (const { source } of this.scheduled) {
      try {
        source.stop();
      } catch {
        // Already stopped or never started.
      }
    }
    this.scheduled = [];
    this.lastDecodedStartSec = null;
    this.lastScheduledEndSec = 0;
    this.lastScheduledWebTime = 0;
    this.loggedTimestampRepair = false;
    this.ac3Epoch++;
    this.ac3PendingSamples = [];
    this.ac3ActiveSample = null;
    this.ac3DrainScheduled = false;
    if (this.ac3DrainTimer !== null) {
      window.clearTimeout(this.ac3DrainTimer);
      this.ac3DrainTimer = null;
    }
    this.ac3DecodeQueueSize = 0;
  }

  private takeNextAc3SampleInsideScheduleWindow(): DemuxedSample | null {
    const currentSec = this.video.currentTime;
    const staleBeforeSec = Math.max(0, currentSec - AC3_STALE_SAMPLE_BEHIND_SEC);
    let bestIndex = -1;
    let bestStartSec = Number.POSITIVE_INFINITY;

    for (let i = 0; i < this.ac3PendingSamples.length; i++) {
      const sample = this.ac3PendingSamples[i];
      const startSec = sample.pts / 1000;
      const durationSec =
        sample.duration > 0 ? sample.duration / 1000 : 1536 / 48000;
      const endSec = startSec + durationSec;

      if (endSec < staleBeforeSec) {
        continue;
      }
      if (startSec - currentSec > MAX_SCHEDULE_AHEAD_SEC) {
        continue;
      }

      if (startSec < bestStartSec) {
        bestStartSec = startSec;
        bestIndex = i;
      }
    }

    if (bestIndex === -1) {
      this.ac3PendingSamples = this.ac3PendingSamples.filter((sample) => {
        const startSec = sample.pts / 1000;
        const durationSec =
          sample.duration > 0 ? sample.duration / 1000 : 1536 / 48000;
        return startSec + durationSec >= staleBeforeSec;
      });
      this.updateAc3DecodeQueueSize();
      return null;
    }

    const [sample] = this.ac3PendingSamples.splice(bestIndex, 1);
    return sample;
  }

  private hasAc3SampleInsideScheduleWindow(): boolean {
    const currentSec = this.video.currentTime;
    const staleBeforeSec = Math.max(0, currentSec - AC3_STALE_SAMPLE_BEHIND_SEC);
    return this.ac3PendingSamples.some((sample) => {
      const startSec = sample.pts / 1000;
      const durationSec =
        sample.duration > 0 ? sample.duration / 1000 : 1536 / 48000;
      return (
        startSec + durationSec >= staleBeforeSec &&
        startSec - currentSec <= MAX_SCHEDULE_AHEAD_SEC
      );
    });
  }

  private resetDecoderAfterDiscontinuity(): void {
    if (!this.ac3Decoder) return;
    try {
      this.ac3Decoder.close();
    } catch {
      // ignore
    }
    const decoder = new Ac3WasmDecoder(this.audio);
    this.ac3Decoder = decoder;
    this.ac3DecodeChain = Promise.resolve();
    void decoder.ready.then(() => {
      if (this.closed || this.ac3Decoder !== decoder) return;
      // eslint-disable-next-line no-console
      console.info(
        `[external-audio] AC-3 WASM decoder reset for track #${this.audio.trackNumber}`,
      );
    }).catch((e) => {
      if (this.closed || this.ac3Decoder !== decoder) return;
      // eslint-disable-next-line no-console
      console.warn("[external-audio] AC-3 WASM decoder reset failed:", e);
    });
  }

  private rememberDecodePosition(decodedStartSec: number, mediaEndSec: number): void {
    this.lastDecodedStartSec = decodedStartSec;
    this.lastScheduledEndSec = Math.max(this.lastScheduledEndSec, mediaEndSec);
  }

  private isRangeCovered(startSec: number, endSec: number): boolean {
    const epsilon = 0.002;
    return this.scheduled.some(
      (range) =>
        range.startSec <= startSec + epsilon &&
        range.endSec >= endSec - epsilon,
    );
  }

  private pruneOldRanges(): void {
    const cutoff = Math.max(0, this.video.currentTime - 5);
    this.scheduled = this.scheduled.filter((range) => range.endSec >= cutoff);
  }

  private getContinuousBufferedEnd(anchorSec: number): number {
    const ranges = [...this.scheduled].sort((a, b) => a.startSec - b.startSec);
    if (ranges.length === 0) return 0;
    const anchorStart = Math.max(0, anchorSec - RANGE_ANCHOR_TOLERANCE_SEC);
    const anchorEnd = anchorSec + RANGE_ANCHOR_TOLERANCE_SEC;
    let end = 0;
    let found = false;

    for (const range of ranges) {
      if (!found) {
        if (range.endSec < anchorStart) continue;
        if (range.startSec > anchorEnd) break;
        found = true;
        end = range.endSec;
        continue;
      }

      if (range.startSec > end + RANGE_MERGE_EPSILON_SEC) break;
      end = Math.max(end, range.endSec);
    }

    return found ? end : 0;
  }

  private updateAc3DecodeQueueSize(): void {
    this.ac3DecodeQueueSize =
      this.ac3PendingSamples.length + (this.ac3ActiveSample ? 1 : 0);
  }
}

function buildDecoderConfigs(audio: AudioTrackInfo): AudioDecoderConfigLike[] {
  if (audio.codec === "flac") {
    return [{
      codec: "flac",
      sampleRate: audio.sampleRate || 48000,
      numberOfChannels: audio.channels || 2,
      description: copyToArrayBuffer(buildFlacDescription(audio.codecPrivate)),
    }];
  }
  if (audio.codec === "ac3") {
    const base = {
      sampleRate: audio.sampleRate || 48000,
      numberOfChannels: audio.channels || 2,
    };
    return ["ac-3", "ac3", "mp4a.a5", "mp4a.A5"].map((codec) => ({
      ...base,
      codec,
    }));
  }
  return [];
}

function buildFlacDescription(codecPrivate: Uint8Array): Uint8Array {
  if (
    codecPrivate.length >= 42 &&
    codecPrivate[0] === 0x66 &&
    codecPrivate[1] === 0x4c &&
    codecPrivate[2] === 0x61 &&
    codecPrivate[3] === 0x43
  ) {
    return codecPrivate;
  }
  const streamInfoBlock = extractFlacStreamInfoBlock(codecPrivate);
  const out = new Uint8Array(4 + streamInfoBlock.length);
  out[0] = 0x66; // f
  out[1] = 0x4c; // L
  out[2] = 0x61; // a
  out[3] = 0x43; // C
  out.set(streamInfoBlock, 4);
  return out;
}

function extractFlacStreamInfoBlock(codecPrivate: Uint8Array): Uint8Array {
  // Some muxers store bare STREAMINFO (34 bytes). Others store the full FLAC
  // metadata stream: 1-byte block header + 3-byte length + payload blocks.
  if (codecPrivate.length === 34) {
    const block = new Uint8Array(38);
    block[0] = 0x80; // last-metadata-block flag + STREAMINFO type (0)
    block[1] = 0x00;
    block[2] = 0x00;
    block[3] = 0x22; // 34 bytes
    block.set(codecPrivate, 4);
    return block;
  }

  let offset = 0;
  while (offset + 4 <= codecPrivate.length) {
    const header = codecPrivate[offset];
    const blockType = header & 0x7f;
    const length =
      (codecPrivate[offset + 1] << 16) |
      (codecPrivate[offset + 2] << 8) |
      codecPrivate[offset + 3];
    const dataStart = offset + 4;
    const dataEnd = dataStart + length;
    if (dataEnd > codecPrivate.length) break;
    if (blockType === 0) {
      const block = codecPrivate.slice(offset, dataEnd);
      block[0] = 0x80; // description carries only STREAMINFO.
      return block;
    }
    offset = dataEnd;
  }

  // Best-effort fallback: let WebCodecs reject the config if this is not
  // usable. That keeps support detection deterministic.
  return codecPrivate;
}

function getWebCodecs(): {
  AudioDecoder?: AudioDecoderConstructorLike;
  EncodedAudioChunk?: EncodedAudioChunkConstructorLike;
} {
  return globalThis as unknown as {
    AudioDecoder?: AudioDecoderConstructorLike;
    EncodedAudioChunk?: EncodedAudioChunkConstructorLike;
  };
}

function newWebEncodedAudioChunk(init: {
  type: "key" | "delta";
  timestamp: number;
  duration?: number;
  data: BufferSource;
}): EncodedAudioChunkLike {
  const { EncodedAudioChunk } = getWebCodecs();
  if (!EncodedAudioChunk) {
    throw new Error("WebCodecs EncodedAudioChunk is not available.");
  }
  return new EncodedAudioChunk(init);
}

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const out = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(out).set(bytes);
  return out;
}

function fmtSec(sec: number): string {
  return `${sec.toFixed(2)}s`;
}
