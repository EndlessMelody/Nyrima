/**
 * Tiny AC-3 decoder adapter around @mediabunny/ac3's single-file FFmpeg WASM
 * build. Chrome's WebCodecs currently rejects AC-3 on many systems, so this
 * gives the external audio lane a real PCM-producing fallback.
 */

import type { AudioTrackInfo, DemuxedSample } from "./types";

type Cwrap = (
  ident: string,
  returnType: "number" | null,
  argTypes: Array<"number">,
) => (...args: Array<number | bigint>) => number | bigint;

interface Ac3Module {
  HEAPU8: Uint8Array;
  cwrap: Cwrap;
}

type Ac3ModuleFactory = () => Promise<unknown>;

export interface DecodedPcmAudio {
  timestampSec: number;
  durationSec: number;
  sampleRate: number;
  numberOfFrames: number;
  numberOfChannels: number;
  planes: Float32Array[];
}

interface AvSampleFormatInfo {
  bytesPerSample: 1 | 2 | 4;
  planar: boolean;
  read(view: DataView, byteOffset: number): number;
}

const AV_SAMPLE_FORMATS: Record<number, AvSampleFormatInfo> = {
  0: {
    bytesPerSample: 1,
    planar: false,
    read: (view, byteOffset) => (view.getUint8(byteOffset) - 128) / 128,
  },
  1: {
    bytesPerSample: 2,
    planar: false,
    read: (view, byteOffset) => view.getInt16(byteOffset, true) / 32768,
  },
  2: {
    bytesPerSample: 4,
    planar: false,
    read: (view, byteOffset) => view.getInt32(byteOffset, true) / 2147483648,
  },
  3: {
    bytesPerSample: 4,
    planar: false,
    read: (view, byteOffset) => view.getFloat32(byteOffset, true),
  },
  5: {
    bytesPerSample: 1,
    planar: true,
    read: (view, byteOffset) => (view.getUint8(byteOffset) - 128) / 128,
  },
  6: {
    bytesPerSample: 2,
    planar: true,
    read: (view, byteOffset) => view.getInt16(byteOffset, true) / 32768,
  },
  7: {
    bytesPerSample: 4,
    planar: true,
    read: (view, byteOffset) => view.getInt32(byteOffset, true) / 2147483648,
  },
  8: {
    bytesPerSample: 4,
    planar: true,
    read: (view, byteOffset) => view.getFloat32(byteOffset, true),
  },
};

let modulePromise: Promise<Ac3Module> | null = null;

export class Ac3WasmDecoder {
  private readonly audio: AudioTrackInfo;
  private module: Ac3Module | null = null;
  private ctx = 0;
  private readyPromise: Promise<void> | null = null;
  private closed = false;

  private initDecoder!: (codecId: number) => number;
  private configureDecodePacket!: (ctx: number, size: number) => number;
  private decodePacket!: (ctx: number, pts: bigint) => number;
  private getDecodedFormat!: (ctx: number) => number;
  private getDecodedPlanePtr!: (ctx: number, plane: number) => number;
  private getDecodedChannels!: (ctx: number) => number;
  private getDecodedSampleRate!: (ctx: number) => number;
  private getDecodedSampleCount!: (ctx: number) => number;
  private getDecodedPts!: (ctx: number) => bigint;
  private flushDecoder!: (ctx: number) => number;
  private closeDecoder!: (ctx: number) => number;

  constructor(audio: AudioTrackInfo) {
    this.audio = audio;
  }

  get ready(): Promise<void> {
    return this.readyPromise ??= this.init();
  }

  async decode(sample: DemuxedSample): Promise<DecodedPcmAudio | null> {
    await this.ready;
    if (this.closed || !this.module || !this.ctx) return null;

    const dataPtr = this.configureDecodePacket(this.ctx, sample.data.byteLength);
    if (dataPtr === 0) {
      throw new Error("AC-3 WASM failed to allocate a decode packet.");
    }
    this.module.HEAPU8.set(sample.data, dataPtr);

    const sampleRate = this.audio.sampleRate || 48000;
    const pts = Math.round((sample.pts / 1000) * sampleRate);
    const ret = this.decodePacket(this.ctx, BigInt(pts));
    if (ret < 0) {
      throw new Error(`AC-3 WASM decode failed with code ${ret}.`);
    }

    const avFormat = this.getDecodedFormat(this.ctx);
    const format = AV_SAMPLE_FORMATS[avFormat];
    if (!format) {
      throw new Error(`AC-3 WASM returned unsupported sample format ${avFormat}.`);
    }

    const decodedSampleRate = this.getDecodedSampleRate(this.ctx);
    const channels = this.getDecodedChannels(this.ctx);
    const frames = this.getDecodedSampleCount(this.ctx);
    const decodedPts = this.getDecodedPts(this.ctx);
    const planes = format.planar
      ? this.copyPlanar(format, channels, frames)
      : this.copyInterleaved(format, channels, frames);

    return {
      timestampSec: Number(decodedPts) / decodedSampleRate,
      durationSec: frames / decodedSampleRate,
      sampleRate: decodedSampleRate,
      numberOfFrames: frames,
      numberOfChannels: channels,
      planes,
    };
  }

  async flush(): Promise<void> {
    await this.ready;
    if (!this.closed && this.ctx) this.flushDecoder(this.ctx);
  }

  close(): void {
    this.closed = true;
    if (!this.ctx) return;
    try {
      this.closeDecoder(this.ctx);
    } catch {
      // ignore
    }
    this.ctx = 0;
  }

  private async init(): Promise<void> {
    const mod = await loadModule();
    this.module = mod;
    this.initDecoder = mod.cwrap("init_decoder", "number", [
      "number",
    ]) as (codecId: number) => number;
    this.configureDecodePacket = mod.cwrap(
      "configure_decode_packet",
      "number",
      ["number", "number"],
    ) as (ctx: number, size: number) => number;
    this.decodePacket = mod.cwrap("decode_packet", "number", [
      "number",
      "number",
    ]) as (ctx: number, pts: bigint) => number;
    this.getDecodedFormat = mod.cwrap("get_decoded_format", "number", [
      "number",
    ]) as (ctx: number) => number;
    this.getDecodedPlanePtr = mod.cwrap("get_decoded_plane_ptr", "number", [
      "number",
      "number",
    ]) as (ctx: number, plane: number) => number;
    this.getDecodedChannels = mod.cwrap("get_decoded_channels", "number", [
      "number",
    ]) as (ctx: number) => number;
    this.getDecodedSampleRate = mod.cwrap("get_decoded_sample_rate", "number", [
      "number",
    ]) as (ctx: number) => number;
    this.getDecodedSampleCount = mod.cwrap("get_decoded_sample_count", "number", [
      "number",
    ]) as (ctx: number) => number;
    this.getDecodedPts = mod.cwrap("get_decoded_pts", "number", [
      "number",
    ]) as (ctx: number) => bigint;
    this.flushDecoder = mod.cwrap("flush_decoder", null, [
      "number",
    ]) as (ctx: number) => number;
    this.closeDecoder = mod.cwrap("close_decoder", null, [
      "number",
    ]) as (ctx: number) => number;

    this.ctx = this.initDecoder(0);
    if (this.ctx === 0) {
      throw new Error("Failed to initialize AC-3 WASM decoder.");
    }
    if (this.closed) {
      this.closeDecoder(this.ctx);
      this.ctx = 0;
    }
  }

  private copyPlanar(
    format: AvSampleFormatInfo,
    channels: number,
    frames: number,
  ): Float32Array[] {
    if (!this.module) return [];
    const planes: Float32Array[] = [];
    const planeBytes = frames * format.bytesPerSample;
    for (let ch = 0; ch < channels; ch++) {
      const ptr = this.getDecodedPlanePtr(this.ctx, ch);
      const bytes = this.module.HEAPU8.subarray(ptr, ptr + planeBytes);
      planes.push(convertBytesToFloat32(bytes, format, frames, 1, 0));
    }
    return planes;
  }

  private copyInterleaved(
    format: AvSampleFormatInfo,
    channels: number,
    frames: number,
  ): Float32Array[] {
    if (!this.module) return [];
    const totalBytes = frames * channels * format.bytesPerSample;
    const ptr = this.getDecodedPlanePtr(this.ctx, 0);
    const bytes = this.module.HEAPU8.subarray(ptr, ptr + totalBytes);
    const planes: Float32Array[] = [];
    for (let ch = 0; ch < channels; ch++) {
      planes.push(convertBytesToFloat32(bytes, format, frames, channels, ch));
    }
    return planes;
  }
}

async function loadModule(): Promise<Ac3Module> {
  modulePromise ??= (async () => {
    const imported = await import(
      "../../../../node_modules/@mediabunny/ac3/dist/modules/build/ac3.js"
    );
    const createAc3Module = imported.default as Ac3ModuleFactory;
    const mod = await createAc3Module();
    return mod as Ac3Module;
  })();
  return modulePromise;
}

export function convertBytesToFloat32(
  bytes: Uint8Array,
  format: AvSampleFormatInfo,
  frames: number,
  strideFrames: number,
  channel: number,
): Float32Array {
  const out = new Float32Array(frames);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < frames; i++) {
    const frameIndex = i * strideFrames + channel;
    out[i] = format.read(view, frameIndex * format.bytesPerSample);
  }
  return out;
}
