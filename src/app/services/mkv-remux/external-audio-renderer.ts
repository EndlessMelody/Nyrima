/**
 * External MKV audio renderer.
 *
 * This is the browser-shaped version of VLC's track model: video remains in
 * the MSE pipeline, while the selected audio track is decoded independently
 * and clocked against the <video> element's currentTime.
 *
 * First target: FLAC dubs. AC-3 is also attempted as a fallback on browsers
 * whose platform WebCodecs decoder exposes it. WebCodecs lets us feed raw
 * audio frames from the MKV demuxer directly to the platform decoder, then
 * schedule PCM through Web Audio without touching the video SourceBuffer.
 */

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
const MAX_LATE_START_SEC = 0.75;
const RANGE_MERGE_EPSILON_SEC = 0.05;
const RANGE_ANCHOR_TOLERANCE_SEC = 0.25;
const TIMESTAMP_REPAIR_MAX_OVERLAP_SEC = 2;

interface ScheduledAudioSource {
  source: AudioBufferSourceNode;
  startSec: number;
  endSec: number;
}

export class ExternalMkvAudioRenderer {
  private audio: AudioTrackInfo;
  private readonly video: HTMLVideoElement;
  private readonly ctx: AudioContext;
  private readonly gain: GainNode;
  private decoder: AudioDecoderLike;
  private scheduled: ScheduledAudioSource[] = [];
  private lastDecodedStartSec: number | null = null;
  private lastScheduledEndSec = 0;
  private loggedTimestampRepair = false;
  private loggedFirstEnqueue = false;
  private loggedFirstSchedule = false;
  private closed = false;
  private readonly cleanups: Array<() => void> = [];

  static async isSupported(audio: AudioTrackInfo): Promise<boolean> {
    const config = buildDecoderConfig(audio);
    if (!config) return false;
    const { AudioDecoder } = getWebCodecs();
    if (!AudioDecoder) return false;

    if (!AudioDecoder.isConfigSupported) return true;

    try {
      const support = await AudioDecoder.isConfigSupported(config);
      return support.supported === true;
    } catch {
      return false;
    }
  }

  constructor(audio: AudioTrackInfo, video: HTMLVideoElement) {
    const { AudioDecoder } = getWebCodecs();
    if (!AudioDecoder) {
      throw new Error("WebCodecs AudioDecoder is not available.");
    }

    this.audio = audio;
    this.video = video;
    this.ctx = new AudioContext({
      sampleRate: audio.sampleRate || undefined,
      latencyHint: "playback",
    });
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.decoder = this.createDecoder(AudioDecoder, audio);
    this.installVideoClockHooks();
    this.syncGain();

    // eslint-disable-next-line no-console
    console.info(
      `[external-audio] renderer ready for track #${audio.trackNumber} ` +
      `(${audio.codec}, ${audio.channels}ch @ ${audio.sampleRate}Hz); ` +
      `ctx=${this.ctx.state}`,
    );
  }

  get bufferedUntilSec(): number {
    this.pruneOldRanges();
    return this.getContinuousBufferedEnd(this.video.currentTime);
  }

  async switchTrack(audio: AudioTrackInfo): Promise<void> {
    if (!buildDecoderConfig(audio)) {
      throw new Error(`External audio does not support ${audio.codec}.`);
    }
    const supported = await ExternalMkvAudioRenderer.isSupported(audio);
    if (!supported) {
      throw new Error(`WebCodecs does not support this ${audio.codec} track.`);
    }

    const { AudioDecoder } = getWebCodecs();
    if (!AudioDecoder) {
      throw new Error("WebCodecs AudioDecoder is not available.");
    }

    this.stopScheduled();
    try {
      this.decoder.close();
    } catch {
      // ignore
    }
    this.audio = audio;
    this.decoder = this.createDecoder(AudioDecoder, audio);
    this.loggedFirstEnqueue = false;
    this.loggedFirstSchedule = false;
  }

  enqueueSamples(samples: DemuxedSample[]): void {
    if (this.closed || this.decoder.state !== "configured") return;

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

  flush(): Promise<void> {
    if (this.closed || this.decoder.state !== "configured") {
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
    try {
      this.decoder.close();
    } catch {
      // ignore
    }
    void this.ctx.close().catch(() => undefined);
  }

  private createDecoder(
    AudioDecoder: AudioDecoderConstructorLike,
    audio: AudioTrackInfo,
  ): AudioDecoderLike {
    const decoder = new AudioDecoder({
      output: (data) => this.handleDecodedAudio(data),
      error: (error) => {
        // eslint-disable-next-line no-console
        console.warn("[external-audio] decoder error:", error);
      },
    });
    const config = buildDecoderConfig(audio);
    if (!config) {
      throw new Error(`External audio does not support ${audio.codec}.`);
    }
    decoder.configure(config);
    return decoder;
  }

  private handleDecodedAudio(data: DecodedAudioDataLike): void {
    if (this.closed) {
      data.close();
      return;
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
      source.playbackRate.value = Math.max(0.1, this.video.playbackRate || 1);
      source.connect(this.gain);

      const rate = Math.max(0.1, this.video.playbackRate || 1);
      let when = this.ctx.currentTime + (mediaStartSec - this.video.currentTime) / rate;
      let offset = 0;
      if (when < this.ctx.currentTime) {
        const lateSec = (this.ctx.currentTime - when) * rate;
        if (lateSec > mediaDurationSec || lateSec > MAX_LATE_START_SEC) {
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
      if (this.decoder.state === "configured") {
        try {
          this.decoder.reset();
          const config = buildDecoderConfig(this.audio);
          if (config) this.decoder.configure(config);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn("[external-audio] decoder reset failed:", e);
        }
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
    this.loggedTimestampRepair = false;
  }

  private rememberDecodePosition(decodedStartSec: number, mediaEndSec: number): void {
    this.lastDecodedStartSec = decodedStartSec;
    this.lastScheduledEndSec = Math.max(this.lastScheduledEndSec, mediaEndSec);
  }

  private isRangeCovered(startSec: number, endSec: number): boolean {
    return this.scheduled.some(
      (range) =>
        range.startSec <= startSec + RANGE_MERGE_EPSILON_SEC &&
        range.endSec >= endSec - RANGE_MERGE_EPSILON_SEC,
    );
  }

  private pruneOldRanges(): void {
    const cutoff = Math.max(0, this.video.currentTime - 5);
    this.scheduled = this.scheduled.filter((range) => range.endSec >= cutoff);
  }

  private getContinuousBufferedEnd(anchorSec: number): number {
    if (this.scheduled.length === 0) return 0;
    const ranges = [...this.scheduled].sort((a, b) => a.startSec - b.startSec);
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
}

function buildDecoderConfig(
  audio: AudioTrackInfo,
): AudioDecoderConfigLike | null {
  if (audio.codec === "flac") {
    return {
      codec: "flac",
      sampleRate: audio.sampleRate || 48000,
      numberOfChannels: audio.channels || 2,
      description: copyToArrayBuffer(buildFlacDescription(audio.codecPrivate)),
    };
  }
  if (audio.codec === "ac3") {
    return {
      codec: "ac-3",
      sampleRate: audio.sampleRate || 48000,
      numberOfChannels: audio.channels || 2,
    };
  }
  return null;
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
