/**
 * MKV demuxer for the remux pipeline.
 *
 * Parses an MKV buffer to extract:
 *   1. Media info (video/audio track metadata) from headers
 *   2. Individual samples from Cluster elements
 *
 * Re-uses the low-level EBML primitives from ../ebml.ts.
 */

import {
  iterateElements,
  readElement,
  readUint,
  readFloat,
  readString,
  parseSimpleBlock,
  parseBlock,
  MKV_ID,
  TRACK_TYPE_VIDEO,
  TRACK_TYPE_AUDIO,
  type EbmlElement,
} from "../ebml";
import type {
  MkvMediaInfo,
  VideoTrackInfo,
  AudioTrackInfo,
  DemuxedSample,
} from "./types";

// ---------------------------------------------------------------------------
// Header parsing
// ---------------------------------------------------------------------------

/**
 * Parse the MKV header region to extract video/audio track info and locate
 * the first Cluster. `buf` should be the first few MB of the file.
 */
export function parseMkvMediaInfo(buf: Uint8Array): MkvMediaInfo {
  const ebml = readElement(buf, 0);
  if (!ebml || ebml.id !== MKV_ID.EBML) {
    throw new Error("Not a valid MKV/EBML file");
  }

  // Find Segment
  let segOffset = ebml.elementLength;
  while (segOffset < buf.length) {
    const el = readElement(buf, segOffset);
    if (!el) throw new Error("MKV Segment not found");
    if (el.id === MKV_ID.Segment) break;
    segOffset += el.elementLength;
  }
  const segment = readElement(buf, segOffset)!;
  const segDataStart = segment.dataOffset;
  const segEnd = Math.min(
    buf.length,
    segment.dataLength === -1
      ? buf.length
      : segment.dataOffset + segment.dataLength,
  );

  let timecodeScaleNs = 1_000_000; // default 1ms
  let durationMs = 0;
  let video: VideoTrackInfo | undefined;
  let audio: AudioTrackInfo | undefined;
  let firstClusterOffset = 0;

  let tracksResult: MediaTracks | undefined;

  for (const el of iterateElements(buf, segDataStart, segEnd)) {
    if (el.id === MKV_ID.Info) {
      const parsed = parseInfoElement(buf, el);
      timecodeScaleNs = parsed.timecodeScaleNs;
      durationMs = parsed.durationMs;
    }
    if (el.id === MKV_ID.Tracks) {
      tracksResult = parseMediaTracks(buf, el);
      video = tracksResult.video;
      audio = tracksResult.audio;
    }
    if (el.id === MKV_ID.Cluster) {
      // Record the absolute byte offset of the first Cluster
      firstClusterOffset = el.elementOffset;
      break; // stop scanning — we have everything we need
    }
  }

  if (!video) {
    const diag = tracksResult
      ? tracksResult.allTracks
          .map(
            (t) =>
              `track#${t.trackNumber} type=${t.trackType} codec="${t.codecId}" private=${t.hasPrivate}`,
          )
          .join("; ")
      : "Tracks element not found";
    throw new Error(
      `No supported video track (H.264/HEVC) found in MKV. Found: [${diag}]`,
    );
  }

  return {
    timecodeScaleNs,
    durationMs,
    video,
    audio,
    firstClusterOffset,
  };
}

function parseInfoElement(
  buf: Uint8Array,
  infoEl: EbmlElement,
): { timecodeScaleNs: number; durationMs: number } {
  let timecodeScaleNs = 1_000_000;
  let durationMs = 0;
  const end = Math.min(buf.length, infoEl.dataOffset + infoEl.dataLength);
  for (const child of iterateElements(buf, infoEl.dataOffset, end)) {
    if (child.id === MKV_ID.TimecodeScale) {
      timecodeScaleNs = readUint(buf, child.dataOffset, child.dataLength);
    }
    if (child.id === 0x4489) {
      // Duration (float, in TimecodeScale units)
      const raw = readFloat(buf, child.dataOffset, child.dataLength);
      if (raw > 0) {
        durationMs = (raw * timecodeScaleNs) / 1_000_000;
      }
    }
  }
  return { timecodeScaleNs, durationMs };
}

interface MediaTracks {
  video?: VideoTrackInfo;
  audio?: AudioTrackInfo;
  /** Diagnostic: all tracks found, for error reporting. */
  allTracks: Array<{ trackNumber: number; trackType: number; codecId: string; hasPrivate: boolean }>;
}

function parseMediaTracks(buf: Uint8Array, tracksEl: EbmlElement): MediaTracks {
  const result: MediaTracks = { allTracks: [] };
  const end = Math.min(buf.length, tracksEl.dataOffset + tracksEl.dataLength);

  for (const entry of iterateElements(buf, tracksEl.dataOffset, end)) {
    if (entry.id !== MKV_ID.TrackEntry) continue;

    let trackNumber = 0;
    let trackType = 0;
    let codecId = "";
    let codecPrivate: Uint8Array | undefined;
    let defaultDurationNs = 0;
    let pixelWidth = 0;
    let pixelHeight = 0;
    let sampleRate = 0;
    let channels = 0;

    const entryEnd = Math.min(
      buf.length,
      entry.dataOffset + entry.dataLength,
    );
    for (const field of iterateElements(buf, entry.dataOffset, entryEnd)) {
      switch (field.id) {
        case MKV_ID.TrackNumber:
          trackNumber = readUint(buf, field.dataOffset, field.dataLength);
          break;
        case MKV_ID.TrackType:
          trackType = readUint(buf, field.dataOffset, field.dataLength);
          break;
        case MKV_ID.CodecID:
          codecId = readString(buf, field.dataOffset, field.dataLength);
          break;
        case MKV_ID.CodecPrivate:
          codecPrivate = buf.slice(field.dataOffset, field.dataOffset + field.dataLength);
          break;
        case MKV_ID.DefaultDuration:
          defaultDurationNs = readUint(buf, field.dataOffset, field.dataLength);
          break;
        case MKV_ID.Video: {
          const vEnd = Math.min(buf.length, field.dataOffset + field.dataLength);
          for (const v of iterateElements(buf, field.dataOffset, vEnd)) {
            if (v.id === MKV_ID.PixelWidth)
              pixelWidth = readUint(buf, v.dataOffset, v.dataLength);
            if (v.id === MKV_ID.PixelHeight)
              pixelHeight = readUint(buf, v.dataOffset, v.dataLength);
          }
          break;
        }
        case MKV_ID.Audio: {
          const aEnd = Math.min(buf.length, field.dataOffset + field.dataLength);
          for (const a of iterateElements(buf, field.dataOffset, aEnd)) {
            if (a.id === MKV_ID.SamplingFrequency)
              sampleRate = readFloat(buf, a.dataOffset, a.dataLength);
            if (a.id === MKV_ID.Channels)
              channels = readUint(buf, a.dataOffset, a.dataLength);
          }
          break;
        }
      }
    }

    result.allTracks.push({
      trackNumber,
      trackType,
      codecId,
      hasPrivate: !!codecPrivate,
    });

    // Determine video codec
    let videoCodec: 'avc' | 'hevc' | null = null;
    if (codecId === "V_MPEG4/ISO/AVC") videoCodec = 'avc';
    if (codecId === "V_MPEGH/ISO/HEVC") videoCodec = 'hevc';

    if (
      trackType === TRACK_TYPE_VIDEO &&
      videoCodec &&
      codecPrivate &&
      !result.video
    ) {
      result.video = {
        trackNumber,
        codec: videoCodec,
        codecPrivate,
        width: pixelWidth,
        height: pixelHeight,
        defaultDurationNs,
      };
    }

    // Determine audio codec
    let audioCodec: 'aac' | 'flac' | 'opus' | null = null;
    if (codecId.startsWith("A_AAC")) audioCodec = 'aac';
    if (codecId === "A_FLAC") audioCodec = 'flac';
    if (codecId === "A_OPUS") audioCodec = 'opus';

    if (
      trackType === TRACK_TYPE_AUDIO &&
      audioCodec &&
      codecPrivate &&
      !result.audio
    ) {
      result.audio = {
        trackNumber,
        codec: audioCodec,
        codecPrivate,
        sampleRate: sampleRate || 48000,
        channels: channels || 2,
        defaultDurationNs,
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cluster → samples
// ---------------------------------------------------------------------------

/**
 * Extract all video/audio samples from a single Cluster element.
 * Returns samples sorted by PTS.
 */
export function extractClusterSamples(
  buf: Uint8Array,
  clusterEl: EbmlElement,
  info: MkvMediaInfo,
): DemuxedSample[] {
  const samples: DemuxedSample[] = [];
  let clusterTimeMs = 0;
  const tsScale = info.timecodeScaleNs / 1_000_000; // ms per timecode unit

  const end = Math.min(buf.length, clusterEl.dataOffset + clusterEl.dataLength);

  for (const child of iterateElements(buf, clusterEl.dataOffset, end)) {
    if (child.id === MKV_ID.Timecode) {
      clusterTimeMs = readUint(buf, child.dataOffset, child.dataLength) * tsScale;
    }
    if (child.id === MKV_ID.SimpleBlock) {
      const block = parseSimpleBlock(buf, child.dataOffset, child.dataLength);
      const sample = blockToSample(block, clusterTimeMs, info);
      if (sample) samples.push(sample);
    }
    if (child.id === MKV_ID.BlockGroup) {
      parseBlockGroup(buf, child, clusterTimeMs, info, samples);
    }
  }

  samples.sort((a, b) => a.pts - b.pts);
  return samples;
}

function blockToSample(
  block: { trackNumber: number; timecode: number; keyframe: boolean; data: Uint8Array },
  clusterTimeMs: number,
  info: MkvMediaInfo,
): DemuxedSample | null {
  const isVideo = block.trackNumber === info.video.trackNumber;
  const isAudio = block.trackNumber === info.audio?.trackNumber;
  if (!isVideo && !isAudio) return null;

  const pts = clusterTimeMs + block.timecode;
  const defaultDurNs = isVideo
    ? info.video.defaultDurationNs
    : info.audio?.defaultDurationNs ?? 0;
  const duration = defaultDurNs > 0 ? defaultDurNs / 1_000_000 : 0;

  return {
    trackNumber: block.trackNumber,
    isVideo,
    pts,
    duration,
    data: block.data,
    isKeyframe: block.keyframe,
  };
}

function parseBlockGroup(
  buf: Uint8Array,
  groupEl: EbmlElement,
  clusterTimeMs: number,
  info: MkvMediaInfo,
  out: DemuxedSample[],
) {
  let blockEl: EbmlElement | null = null;
  let blockDurationMs = 0;
  const end = Math.min(buf.length, groupEl.dataOffset + groupEl.dataLength);

  for (const child of iterateElements(buf, groupEl.dataOffset, end)) {
    if (child.id === MKV_ID.Block) blockEl = child;
    if (child.id === MKV_ID.BlockDuration) {
      const raw = readUint(buf, child.dataOffset, child.dataLength);
      blockDurationMs = (raw * info.timecodeScaleNs) / 1_000_000;
    }
  }

  if (!blockEl) return;
  const block = parseBlock(buf, blockEl.dataOffset, blockEl.dataLength);
  const sample = blockToSample(
    { ...block, keyframe: true }, // blocks in BlockGroup are keyframes by default
    clusterTimeMs,
    info,
  );
  if (sample) {
    if (blockDurationMs > 0) sample.duration = blockDurationMs;
    out.push(sample);
  }
}
