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
      audioTracks = tracksResult.audioTracks;
    }
    if (el.id === MKV_ID.Cluster) {
      // Record the absolute byte offset of the first Cluster
      firstClusterOffset = el.elementOffset;
      break; // stop scanning — we have everything we need
    }
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

  return {
    timecodeScaleNs,
    durationMs,
    video,
    audio,
    audioTracks,
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
      for (const s of blockToSamples(block, clusterTimeMs, info)) {
        samples.push(s);
      }
    }
    if (child.id === MKV_ID.BlockGroup) {
      parseBlockGroup(buf, child, clusterTimeMs, info, samples);
    }
  }

  // Intentionally NOT sorted. MKV stores SimpleBlocks in decode order;
  // their `timecode` field is the PTS, which for HEVC/AVC with B-frames is
  // non-monotonic across the array (a B-frame's PTS sits between I/P-frames
  // that decode before it). Sorting by PTS would emit samples in DISPLAY
  // order, which puts B-frames ahead of the references they need — Chrome's
  // HEVC decoder reads sample 0 (B), can't find its forward reference, and
  // rejects the media fragment. Keeping file order preserves decode order
  // so the mp4-generator can emit them in the same order in the moof's trun.
  //
  // (Long-term: emit per-sample `composition_time_offset` (ctts) in trun so
  // the buffer's reported PTS matches display order without re-sorting.
  // Until then PTS in the buffer equals DTS plus accumulated durations,
  // which is close enough for playback — Chrome reorders via the
  // bitstream's PicOrderCnt anyway.)
  return samples;
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

  const defaultDurNs = isVideo
    ? info.video.defaultDurationNs
    : info.audio?.defaultDurationNs ?? 0;
  const durationMs = defaultDurNs > 0 ? defaultDurNs / 1_000_000 : 0;
  const blockPts = clusterTimeMs + block.timecode;

  // Laced blocks contain N audio frames sharing one timecode. Each frame's
  // PTS advances by `durationMs` from the block's base — that's how
  // mkvtoolnix / ffmpeg recover per-frame timestamps from a laced block.
  const out: DemuxedSample[] = [];
  for (let i = 0; i < block.frames.length; i++) {
    out.push({
      trackNumber: block.trackNumber,
      isVideo,
      pts: blockPts + i * durationMs,
      duration: durationMs,
      data: block.frames[i],
      isKeyframe: block.keyframe,
    });
  }
  return out;
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
