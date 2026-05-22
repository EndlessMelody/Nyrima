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

/**
 * Options passed to `parseMkvMediaInfo`. Currently only the audio selector —
 * lets the MSE controller's `switchAudio()` rebuild the init segment around
 * a specific track without re-parsing other arguments through every call.
 */
export interface ParseMkvMediaInfoOptions {
  /**
   * MKV TrackNumber of the audio track to surface as `info.audio`. When
   * omitted (or not found among the compatible tracks), the first compatible
   * track in muxer order is selected — matching the prior single-track
   * behaviour so non-dub callers get the same result.
   */
  audioTrackNumber?: number;
}
import type {
  Ac3SpecificBoxFields,
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
export function parseMkvMediaInfo(
  buf: Uint8Array,
  opts: ParseMkvMediaInfoOptions = {},
): MkvMediaInfo {
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
  let audioTracks: AudioTrackInfo[] = [];
  let firstClusterOffset = 0;
  // Tracks the DECLARED end of the last top-level element we walked, even
  // when its content extends past the header buffer. When the first Cluster
  // lives past the buffer (e.g. a multi-MB Cues element sits between Tracks
  // and the first Cluster), this is where streaming should begin — otherwise
  // we'd land in the middle of Cues content and the stream parser would see
  // garbage until it stumbles into a Cluster ID by luck.
  let postHeaderResumeOffset = segDataStart;

  let tracksResult: MediaTracks | undefined;

  // Manual walk so we can advance past partial top-level elements using
  // their DECLARED size, not the buffer-clamped size that iterateElements
  // would yield. iterateElements stops yielding after one partial element;
  // we need to keep accounting for what's past the buffer.
  let walkOffset = segDataStart;
  while (walkOffset < segEnd && walkOffset < buf.length) {
    if (buf[walkOffset] === 0x00) {
      walkOffset++;
      continue;
    }
    const el = readElement(buf, walkOffset);
    if (!el) break;

    if (el.id === MKV_ID.Cluster) {
      firstClusterOffset = el.elementOffset;
      break;
    }

    // Only parse Info / Tracks when their data fully fits in the buffer.
    if (
      el.id === MKV_ID.Info &&
      el.dataLengthRaw !== -1 &&
      el.dataOffset + el.dataLengthRaw <= buf.length
    ) {
      const parsed = parseInfoElement(buf, el);
      timecodeScaleNs = parsed.timecodeScaleNs;
      durationMs = parsed.durationMs;
    }
    if (
      el.id === MKV_ID.Tracks &&
      el.dataLengthRaw !== -1 &&
      el.dataOffset + el.dataLengthRaw <= buf.length
    ) {
      tracksResult = parseMediaTracks(buf, el);
      video = tracksResult.video;
      audioTracks = tracksResult.audioTracks;
    }

    const declaredEnd =
      el.dataLengthRaw === -1
        ? el.elementOffset + el.elementLength
        : el.dataOffset + el.dataLengthRaw;
    postHeaderResumeOffset = declaredEnd;
    walkOffset = declaredEnd;
  }

  if (firstClusterOffset <= 0) {
    // Prefer a real Cluster signature if findFirstClusterOffset can find one;
    // otherwise resume at the declared end of the last walked element. If
    // even that's still inside the header buffer (which would mean no Cues/
    // Attachments lived past the header), fall back to buf.length.
    firstClusterOffset =
      findFirstClusterOffset(buf, segDataStart, segEnd) ??
      Math.max(postHeaderResumeOffset, buf.length);
  }

  // Select the requested audio track (caller's `audioTrackNumber`), falling
  // back to the first compatible track when the caller hasn't expressed a
  // preference or the requested number isn't in the file. This is how
  // `MkvMseController.switchAudio()` swaps dubs without re-parsing the file.
  const requestedTrackNumber = opts.audioTrackNumber;
  const audio =
    (requestedTrackNumber != null
      ? audioTracks.find((t) => t.trackNumber === requestedTrackNumber)
      : undefined) ?? audioTracks[0];

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

  const info: MkvMediaInfo = {
    timecodeScaleNs,
    durationMs,
    video,
    audio,
    audioTracks,
    firstClusterOffset,
  };
  return attachAc3ConfigFromBufferedClusters(buf, info);
}

export function findFirstClusterOffset(
  buf: Uint8Array,
  start: number,
  end: number,
): number | null {
  const bound = Math.min(end, buf.length - 4);
  for (let offset = Math.max(0, start); offset <= bound; offset++) {
    if (
      buf[offset] !== 0x1f ||
      buf[offset + 1] !== 0x43 ||
      buf[offset + 2] !== 0xb6 ||
      buf[offset + 3] !== 0x75
    ) {
      continue;
    }
    const el = readElement(buf, offset);
    if (el?.id === MKV_ID.Cluster) return offset;
  }
  return null;
}

function attachAc3ConfigFromBufferedClusters(
  buf: Uint8Array,
  info: MkvMediaInfo,
): MkvMediaInfo {
  const audio = info.audio;
  if (!audio || audio.codec !== "ac3" || audio.ac3) return info;
  if (info.firstClusterOffset <= 0 || info.firstClusterOffset >= buf.length) {
    return info;
  }

  const ac3 = findFirstAc3Config(buf, info.firstClusterOffset, info);
  if (!ac3) return info;

  const nextAudio = { ...audio, ac3 };
  return {
    ...info,
    audio: nextAudio,
    audioTracks: info.audioTracks.map((track) =>
      track.trackNumber === audio.trackNumber ? { ...track, ac3 } : track,
    ),
  };
}

function findFirstAc3Config(
  buf: Uint8Array,
  firstClusterOffset: number,
  info: MkvMediaInfo,
): Ac3SpecificBoxFields | null {
  let offset = firstClusterOffset;
  while (offset < buf.length) {
    if (buf[offset] === 0x00) {
      offset++;
      continue;
    }
    const el = readElement(buf, offset);
    if (!el) break;

    if (el.id === MKV_ID.Cluster) {
      const samples = extractClusterSamples(buf, el, info);
      for (const sample of samples) {
        if (
          !sample.isVideo &&
          sample.trackNumber === info.audio?.trackNumber
        ) {
          const parsed = parseAc3SpecificBoxFields(sample.data);
          if (parsed) return parsed;
        }
      }
    }

    if (el.dataLengthRaw === -1) break;
    offset = el.dataOffset + el.dataLengthRaw;
  }
  return null;
}

export function parseAc3SpecificBoxFields(
  frame: Uint8Array,
): Ac3SpecificBoxFields | null {
  if (frame.length < 7 || frame[0] !== 0x0b || frame[1] !== 0x77) {
    return null;
  }

  let bitOffset = 0;
  const readBits = (count: number): number => {
    let value = 0;
    for (let i = 0; i < count; i++) {
      const byteIndex = bitOffset >> 3;
      if (byteIndex >= frame.length) return 0;
      const bitIndex = 7 - (bitOffset & 0x07);
      value = (value << 1) | ((frame[byteIndex] >> bitIndex) & 0x01);
      bitOffset++;
    }
    return value;
  };

  readBits(16); // syncword
  readBits(16); // crc1
  const fscod = readBits(2);
  const frmsizecod = readBits(6);
  const bsid = readBits(5);
  const bsmod = readBits(3);
  const acmod = readBits(3);

  if (fscod === 3 || frmsizecod > 37) return null;

  if ((acmod & 0x01) !== 0 && acmod !== 0x01) {
    readBits(2); // cmixlev
  }
  if ((acmod & 0x04) !== 0) {
    readBits(2); // surmixlev
  }
  if (acmod === 0x02) {
    readBits(2); // dsurmod
  }

  return {
    fscod,
    bsid,
    bsmod,
    acmod,
    lfeon: readBits(1),
    bitRateCode: frmsizecod >> 1,
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
  audioTracks: AudioTrackInfo[];
  /** Diagnostic: all tracks found, for error reporting. */
  allTracks: Array<{ trackNumber: number; trackType: number; codecId: string; hasPrivate: boolean }>;
}

function parseMediaTracks(buf: Uint8Array, tracksEl: EbmlElement): MediaTracks {
  const result: MediaTracks = { allTracks: [], audioTracks: [] };
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
    let language = "und";
    let name = "";

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
        case MKV_ID.Language:
          language = readString(buf, field.dataOffset, field.dataLength);
          break;
        case MKV_ID.Name:
          name = readString(buf, field.dataOffset, field.dataLength);
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

    // Determine audio codec. AC-3 (Dolby Digital) is unusual in that MKV
    // doesn't ship a CodecPrivate for it — the per-frame sync headers carry
    // everything libavcodec needs — so we don't require `codecPrivate` to be
    // present for `ac3` like we do for the others.
    let audioCodec: 'aac' | 'flac' | 'opus' | 'ac3' | null = null;
    if (codecId.startsWith("A_AAC")) audioCodec = 'aac';
    else if (codecId === "A_FLAC") audioCodec = 'flac';
    else if (codecId === "A_OPUS") audioCodec = 'opus';
    else if (codecId === "A_AC3") audioCodec = 'ac3';

    if (
      trackType === TRACK_TYPE_AUDIO &&
      audioCodec &&
      (codecPrivate || audioCodec === 'ac3')
    ) {
      result.audioTracks.push({
        trackNumber,
        codec: audioCodec,
        codecPrivate: codecPrivate ?? new Uint8Array(0),
        sampleRate: sampleRate || 48000,
        channels: channels || 2,
        defaultDurationNs,
        language,
        name,
      });
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
  const end = Math.min(buf.length, clusterEl.dataOffset + clusterEl.dataLength);
  return extractClusterSamplesFromRange(
    buf,
    clusterEl.dataOffset,
    end,
    0,
    info,
  ).samples;
}

export interface ClusterSampleRangeResult {
  samples: DemuxedSample[];
  clusterTimeMs: number;
  /** Offset of the first byte not consumed. If this is less than `end`, the
   *  remaining bytes begin an incomplete EBML child element. */
  consumedOffset: number;
  /** True when parsing stopped because the next top-level Cluster began. */
  reachedClusterBoundary: boolean;
}

/**
 * Extract complete child elements from a Cluster byte range.
 *
 * This is the streaming-friendly variant used when a Cluster is larger than
 * the current network chunk. It emits only fully-present SimpleBlock /
 * BlockGroup children and returns the first incomplete child offset so the
 * controller can keep just that tail for the next read.
 */
export function extractClusterSamplesFromRange(
  buf: Uint8Array,
  start: number,
  end: number,
  initialClusterTimeMs: number,
  info: MkvMediaInfo,
): ClusterSampleRangeResult {
  const samples: DemuxedSample[] = [];
  let clusterTimeMs = initialClusterTimeMs;
  const tsScale = info.timecodeScaleNs / 1_000_000; // ms per timecode unit
  const safeEnd = Math.min(end, buf.length);
  let offset = start;

  while (offset < safeEnd) {
    if (buf[offset] === 0x00) {
      offset++;
      continue;
    }

    const child = readElement(buf, offset);
    if (!child) break;
    if (child.id === MKV_ID.Cluster) {
      return {
        samples,
        clusterTimeMs,
        consumedOffset: offset,
        reachedClusterBoundary: true,
      };
    }
    const childEnd =
      child.dataLengthRaw === -1
        ? child.elementOffset + child.elementLength
        : child.dataOffset + child.dataLengthRaw;
    if (childEnd > safeEnd) break;

    if (child.id === MKV_ID.Timecode) {
      clusterTimeMs = readUint(buf, child.dataOffset, child.dataLength) * tsScale;
    }
    if (child.id === MKV_ID.SimpleBlock) {
      const block = parseSimpleBlock(buf, child.dataOffset, child.dataLength);
      for (const s of blockToSamples(block, clusterTimeMs, info)) {
        samples.push(s);
      }
    }
    if (child.id === MKV_ID.BlockGroup) {
      parseBlockGroup(buf, child, clusterTimeMs, info, samples);
    }
    offset = childEnd;
  }

  // Intentionally NOT sorted. MKV stores SimpleBlocks in decode order; their
  // `timecode` field is the PTS, which for HEVC/AVC with B-frames is
  // non-monotonic across the array. Keeping file order preserves decode order
  // so the mp4-generator can emit samples in the same order in the moof trun.
  return { samples, clusterTimeMs, consumedOffset: offset, reachedClusterBoundary: false };
}

function blockToSamples(
  block: {
    trackNumber: number;
    timecode: number;
    keyframe: boolean;
    frames: Uint8Array[];
  },
  clusterTimeMs: number,
  info: MkvMediaInfo,
): DemuxedSample[] {
  const isVideo = block.trackNumber === info.video.trackNumber;
  const isAudio = block.trackNumber === info.audio?.trackNumber;
  if (!isVideo && !isAudio) return [];

  const audio = isAudio ? info.audio : undefined;
  const defaultDurNs = isVideo
    ? info.video.defaultDurationNs
    : audio?.defaultDurationNs ?? 0;
  const defaultDurationMs = defaultDurNs > 0 ? defaultDurNs / 1_000_000 : 0;
  let framePts = clusterTimeMs + block.timecode;

  // Laced blocks contain N audio frames sharing one timecode. Each frame's
  // PTS advances by its packet duration from the block's base. Opus-in-MKV
  // commonly omits DefaultDuration, so derive the duration from the Opus TOC
  // byte before falling back to TrackEntry DefaultDuration.
  const out: DemuxedSample[] = [];
  for (let i = 0; i < block.frames.length; i++) {
    const frame = block.frames[i];
    const durationMs =
      getFrameDurationMs(frame, isVideo, audio, defaultDurationMs);
    out.push({
      trackNumber: block.trackNumber,
      isVideo,
      pts: framePts,
      duration: durationMs,
      data: frame,
      isKeyframe: block.keyframe,
    });
    if (durationMs > 0) framePts += durationMs;
  }
  return out;
}

function getFrameDurationMs(
  frame: Uint8Array,
  isVideo: boolean,
  audio: AudioTrackInfo | undefined,
  defaultDurationMs: number,
): number {
  if (!isVideo && audio?.codec === "opus") {
    const opusDurationMs = getOpusPacketDurationMs(frame, audio.sampleRate);
    if (opusDurationMs > 0) return opusDurationMs;
  }
  if (!isVideo && audio?.codec === "ac3") {
    const sampleRate = audio.sampleRate > 0 ? audio.sampleRate : 48000;
    return (1536 * 1000) / sampleRate;
  }
  return defaultDurationMs;
}

function getOpusPacketDurationMs(
  packet: Uint8Array,
  sampleRate: number,
): number {
  if (packet.length === 0) return 0;
  const rate = sampleRate > 0 ? sampleRate : 48000;
  const toc = packet[0];
  let samplesPerFrame: number;

  if ((toc & 0x80) !== 0) {
    samplesPerFrame = (rate << ((toc >> 3) & 0x03)) / 400;
  } else if ((toc & 0x60) === 0x60) {
    samplesPerFrame = (toc & 0x08) !== 0 ? rate / 50 : rate / 100;
  } else {
    const size = (toc >> 3) & 0x03;
    samplesPerFrame = size === 3 ? (rate * 60) / 1000 : (rate << size) / 100;
  }

  const frameCountCode = toc & 0x03;
  let frameCount = 1;
  if (frameCountCode === 1 || frameCountCode === 2) {
    frameCount = 2;
  } else if (frameCountCode === 3) {
    if (packet.length < 2) return 0;
    frameCount = packet[1] & 0x3f;
  }

  if (frameCount <= 0) return 0;
  return (samplesPerFrame * frameCount * 1000) / rate;
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
  const blockSamples = blockToSamples(
    { ...block, keyframe: true }, // blocks in BlockGroup are keyframes by default
    clusterTimeMs,
    info,
  );
  if (blockSamples.length > 0) {
    // BlockDuration applies to the whole laced run; spread it evenly across
    // the frames so PTS still progresses monotonically inside the block.
    if (blockDurationMs > 0) {
      const perFrame = blockDurationMs / blockSamples.length;
      for (let i = 0; i < blockSamples.length; i++) {
        blockSamples[i].duration = perFrame;
      }
    }
    for (const s of blockSamples) out.push(s);
  }
}
