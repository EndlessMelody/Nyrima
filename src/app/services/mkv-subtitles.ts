/**
 * MKV embedded subtitle extraction.
 *
 * Strategy:
 *   1. Fetch a small header region (4 MB) via Range request → parse Tracks,
 *      Info (TimecodeScale), and any Clusters that happen to live in the
 *      header window. Emit those cues immediately.
 *   2. Open a single streaming Range request for the rest of the Segment and
 *      read it via ReadableStream. Parse Clusters as they arrive and append
 *      new cues to each subtitle track. Emit progress on every chunk so the
 *      UI can render the active track while extraction is still running.
 *
 * Works with text-based codecs (ASS/SSA/UTF8). Image-based subs (VobSub/PGS)
 * are flagged so the UI can show a "needs renderer" hint without trying to
 * decode bytes that aren't text.
 */

import {
  parseMkvHeader,
  parseSimpleBlock,
  parseBlock,
  iterateElements,
  readElement,
  readUint,
  MKV_ID,
  TRACK_TYPE_AUDIO,
  TRACK_TYPE_SUBTITLE,
  type EbmlElement,
  type MkvTrack,
} from "./ebml";
import {
  alignmentToPlacement,
  isAssCueHidden,
  stripAssFontReferences,
  stripAssTags,
  type SubCue,
  type SubStyles,
} from "./subtitles";
import {
  buildPgsCompositions,
  type PgsBlock,
  type PgsComposition,
} from "./pgs-renderer";
import { fetchRange } from "./drive-api";

/**
 * Audio-track metadata pulled from the same header parse that produces
 * `ExtractedMkvSub[]`. Lets PlayerPage populate the SettingsPopover audio
 * picker with the muxer-authored names (e.g. "Japanese 5.1", "English
 * Commentary") instead of the empty strings Chrome returns via
 * `HTMLVideoElement.audioTracks` for MKV. In MSE mode this list is also the
 * source of truth — Chrome doesn't expose `audioTracks` at all for a
 * MediaSource-driven `<video>`, so without this list the user has no way
 * to switch dubs.
 */
export interface MkvAudioTrack {
  /** MKV `TrackNumber`. Stable id we pass back to the MSE controller. */
  number: number;
  /** Raw Matroska CodecID — `A_AAC`, `A_FLAC`, `A_OPUS`, … */
  codecId: string;
  /** ISO 639-2/B language tag from the track. `"und"` when unspecified. */
  language: string;
  /** Free-form `Name` element. Empty when the muxer didn't author one. */
  name: string;
  /** Pre-rendered short label for the picker. Built from name → language → codec. */
  label: string;
  /** Channel count, when the muxer wrote one. */
  channels?: number;
  /**
   * True when the codec is in the remux pipeline's whitelist (AAC/FLAC/Opus
   * /AC-3). Tracks outside that set are non-switchable because Nyrima can't
   * pack them into a fresh fMP4 init segment.
   */
  remuxable: boolean;
  /**
   * True when `MediaSource.isTypeSupported` accepts the muxed combination
   * of this audio track's codec with the file's video codec OR when the
   * external WebCodecs audio path can decode it. Even when `remuxable` is
   * true the browser can still refuse a specific combo — Chrome notably
   * blocks HEVC + AC-3 together in MSE even though each decodes individually.
   * Populated by PlayerPage right after the header parse so the picker can
   * disable rows that would silently fail.
   *
   * `undefined` means "not probed yet" (e.g. the audio list arrived before
   * the support check ran). Callers should treat `undefined` as "let the
   * user try" — only an explicit `false` disables the row.
   */
  browserSupported?: boolean;
  /**
   * True when the normal MSE/fMP4 lane accepts this track. When both this
   * and `externalAudioSupported` are true, prefer MSE; the external lane is
   * only a fallback for codecs/browser combos SourceBuffer refuses.
   */
  mseAudioSupported?: boolean;
  /**
   * True when Nyrima can bypass MSE audio and decode this track separately
   * with WebCodecs + Web Audio. Used as a fallback for codecs/browser combos
   * SourceBuffer refuses, currently FLAC and platform-supported AC-3.
   */
  externalAudioSupported?: boolean;
}

export interface ExtractedMkvSub {
  id: string;
  lang: string;
  label: string;
  codecId: string;
  cues: SubCue[];
  imageBased: boolean;
  /**
   * Reconstituted ASS/SSA source for libass/JASSUB. Present for S_TEXT/ASS
   * and S_TEXT/SSA tracks when CodecPrivate supplied the script header.
   */
  assSource?: string;
  /**
   * False while native-mode background extraction is still appending Dialogue
   * rows. The player should keep using the CSS text overlay until this flips
   * true, otherwise JASSUB gets mounted with a header-only/incomplete script.
   */
  assSourceComplete?: boolean;
  /** Internal immutable header used while appending streamed Dialogue lines. */
  assHeader?: string;
  /**
   * Decoded PGS compositions for `S_HDMV/PGS` tracks. Empty until finalize()
   * has folded the streamed blocks; PgsOverlay reads this once the track
   * becomes active. VobSub tracks stay null — we don't decode SPU yet.
   */
  pgsCompositions?: PgsComposition[];
  /** True once `pgsCompositions` reflects every block in the file. */
  pgsCompositionsComplete?: boolean;
}

export interface MkvExtractOptions {
  /**
   * Pre-fetched header bytes. When supplied, the extractor skips its own
   * header Range fetch. The buffer must start at byte 0 of the file.
   */
  prefetchedBuf?: { buf: Uint8Array; fileSize: number };
  /**
   * Fired once, as soon as the header bytes are available. Useful for
   * handing the buffer to a parallel consumer (e.g. the MSE controller)
   * so it doesn't re-fetch the same bytes.
   */
  onHeader?: (header: { buf: Uint8Array; fileSize: number }) => void;
  /**
   * Called every time new cues are appended. The same `subs` reference is
   * passed each time with cues accumulating in place. Consumers should treat
   * each call as "more cues are now available for the active track".
   */
  onProgress?: (subs: ExtractedMkvSub[]) => void;
  /** Cancel the streaming walk. */
  signal?: AbortSignal;
}

const HEADER_FETCH_SIZE = 4 * 1024 * 1024; // 4 MB — header + first few clusters

export async function extractMkvSubtitles(
  fileId: string,
  opts: MkvExtractOptions = {},
): Promise<{
  subs: ExtractedMkvSub[];
  /** Every audio track found in the header, in muxer order. */
  audioTracks: MkvAudioTrack[];
  headerBuf: Uint8Array;
  fileSize: number;
  /**
   * Byte offset in `headerBuf` right after the last fully-parsed EBML element.
   * Native-mode streamers that start their stream at `headerBuf.length` MUST
   * pre-feed `headerBuf.slice(headerParsedTo)` to the feeder so the parser
   * resumes at a known element boundary instead of misaligning mid-payload.
   * (MSE callers pre-feed from `firstClusterOffset` instead; they don't use
   * this field.)
   */
  headerParsedTo: number;
  /**
   * Feed raw MKV bytes from an external stream (e.g. the MSE controller)
   * to progressively extract subtitle cues without a separate API call.
   * Returns true if new cues were added. Call `finalize()` when the stream
   * is complete to sort + de-overlap all tracks.
   */
  feedChunk: ((data: Uint8Array) => boolean) | null;
  /** Sort + de-overlap after all chunks have been fed. */
  finalize: (() => void) | null;
}> {
  const signal = opts.signal;

  // 1. Header bytes ---------------------------------------------------------
  let headerBuf: Uint8Array;
  let fileSize: number;
  if (opts.prefetchedBuf) {
    headerBuf = opts.prefetchedBuf.buf;
    fileSize = opts.prefetchedBuf.fileSize;
  } else {
    const { blob, total } = await fetchRange(fileId, 0, HEADER_FETCH_SIZE - 1);
    headerBuf = new Uint8Array(await blob.arrayBuffer());
    fileSize = total;
  }
  if (signal?.aborted) {
    return emptyExtractResult(headerBuf, fileSize);
  }
  opts.onHeader?.({ buf: headerBuf, fileSize });

  // 2. Parse header ---------------------------------------------------------
  let header;
  try {
    header = parseMkvHeader(headerBuf);
  } catch {
    return emptyExtractResult(headerBuf, fileSize);
  }
  if (!header.tracks) return emptyExtractResult(headerBuf, fileSize);

  // Audio tracks share the same header parse — we surface them so PlayerPage
  // can populate the SettingsPopover picker without a second pass.
  const audioTracks: MkvAudioTrack[] = header.tracks
    .filter((t) => t.type === TRACK_TYPE_AUDIO)
    .map(toMkvAudioTrack);

  const subTracks = header.tracks.filter((t) => t.type === TRACK_TYPE_SUBTITLE);
  // eslint-disable-next-line no-console
  console.info(
    `[subs] header parsed: fileSize=${fileSize} subTracks=${subTracks.length} ` +
    `audioTracks=${audioTracks.length} ` +
    `tracks=${subTracks.map((t) => `#${t.number}:${t.codecId}/${t.language}`).join(",")} ` +
    `audio=${audioTracks.map((a) => `#${a.number}:${a.codecId}/${a.language}`).join(",")}`,
  );
  if (subTracks.length === 0) {
    return { ...emptyExtractResult(headerBuf, fileSize), audioTracks };
  }

  const timecodeScale = header.timecodeScale;

  // 3. Initialise per-track results + per-track ASS metadata ---------------
  const infoByTrack = new Map<number, AssTrackInfo>();
  for (const t of subTracks) {
    infoByTrack.set(t.number, parseAssTrackInfo(t.codecPrivate));
  }
  const assEventsByTrack = new Map<number, string[]>();
  // Per-track dedupe sets keyed on the cue's deterministic id
  // (`${startSec.toFixed(3)}-${text.slice(0, 20)}`). Some paths feed the same
  // header bytes to feedChunk twice — e.g. MSE mode where the MSE controller
  // pre-feeds [firstClusterOffset, headerBuf.length] for playback even though
  // `parseRegionForCues` already walked that same region for the subtitle
  // tracks. Without this guard, every cue in the first 4 MB of the file ends
  // up duplicated and the libass script bloats by the same factor (visible
  // as e.g. ~2000 cues for an Oregairu Zoku Blu-ray that actually has ~600).
  const seenCueIdsByTrack = new Map<number, Set<string>>();
  // Per-PGS-track raw block accumulator. We pile every Display Set's bytes
  // here as clusters arrive, then run buildPgsCompositions once in
  // finalize() so the overlay sees a stable sorted list. Decoding live
  // (per cluster) would let users see PGS while streaming but risks
  // emitting half-formed Display Sets — the all-at-once finalize keeps the
  // composition pairing logic simple.
  const pgsBlocksByTrack = new Map<number, PgsBlock[]>();

  const results: ExtractedMkvSub[] = subTracks.map((t) => {
    const normCodec = t.codecId.toUpperCase().replace(/\s/g, "");
    const isPgs = normCodec === "S_HDMV/PGS";
    const isVobSub = normCodec === "S_VOBSUB";
    const imageBased = isPgs || isVobSub;
    const assInfo = infoByTrack.get(t.number) ?? EMPTY_TRACK_INFO;
    const assSource =
      isAssCodec(t.codecId) && assInfo.sourceHeader
        ? buildAssSource(assInfo.sourceHeader, [])
        : undefined;
    if (assSource) assEventsByTrack.set(t.number, []);
    if (!imageBased) seenCueIdsByTrack.set(t.number, new Set());
    if (isPgs) pgsBlocksByTrack.set(t.number, []);
    return {
      id: `mkv-${t.number}-${t.language}`,
      lang: t.language,
      label: t.name || trackLabelFromCodec(t.codecId, t.language),
      codecId: t.codecId,
      cues: [],
      imageBased,
      assSource,
      assSourceComplete: assSource ? false : undefined,
      assHeader: assInfo.sourceHeader ?? undefined,
      pgsCompositions: isPgs ? [] : undefined,
      pgsCompositionsComplete: isPgs ? false : undefined,
    };
  });

  // VobSub (S_VOBSUB) is still flagged image-based with no decoder path —
  // bail out early when *every* track is in that bucket. PGS tracks no
  // longer count toward this gate: we collect their blocks below.
  if (results.every((r) => r.codecId.toUpperCase().replace(/\s/g, "") === "S_VOBSUB")) {
    opts.onProgress?.(results);
    return {
      subs: results,
      audioTracks,
      headerBuf,
      fileSize,
      headerParsedTo: 0,
      feedChunk: null,
      finalize: null,
    };
  }

  // 4. Parse clusters present in the header buffer --------------------------
  const segEndInHeader = Math.min(
    headerBuf.length,
    header.segmentOffset + header.segmentLength,
  );
  const headerParsedTo = parseRegionForCues(
    headerBuf,
    header.segmentOffset,
    segEndInHeader,
    subTracks,
    timecodeScale,
    infoByTrack,
    assEventsByTrack,
    pgsBlocksByTrack,
    seenCueIdsByTrack,
    results,
  );
  // eslint-disable-next-line no-console
  console.info(
    `[subs] header-region cues: ${results
      .map((r) => `${r.id}=${r.cues.length}`)
      .join(", ")} parsedTo=${headerParsedTo}/${headerBuf.length}`,
  );
  opts.onProgress?.(results);

  // 5. Build a chunk feeder usable from any byte source ---------------------
  //
  // Two callers feed this:
  //   - MSE controller's processChunk (piggyback on the same stream used for
  //     playback — zero extra API calls for MKV→MSE files)
  //   - The native-mode background sub stream in PlayerPage (a separate
  //     low-priority fetch that runs for natively-played MKVs, since
  //     <video> swallows the raw bytes and we can't piggyback)
  //
  // The feeder maintains its OWN leftover buffer so callers don't have to
  // align chunks to EBML element boundaries — a 64 KB stream read mid-cluster
  // is fine. Partial elements at the tail are stashed and concatenated with
  // the next chunk.
  let leftover: Uint8Array | null = null;
  let finalized = false;
  let totalChunks = 0;
  let clusterCount = 0;

  const feedChunk = (data: Uint8Array): boolean => {
    if (finalized) return false;
    totalChunks++;
    const buf = leftover ? concatU8(leftover, data) : data;
    leftover = null;
    let cuesAdded = false;
    let offset = 0;

    while (offset < buf.length) {
      if (buf[offset] === 0x00) { offset++; continue; }

      const el = readElement(buf, offset);
      if (!el) {
        leftover = buf.slice(offset);
        break;
      }

      const rawEnd =
        el.dataLengthRaw === -1 ? Infinity : el.dataOffset + el.dataLengthRaw;
      if (rawEnd > buf.length) {
        leftover = buf.slice(offset);
        break;
      }

      if (el.id === MKV_ID.Cluster) {
        clusterCount++;
        const added = parseClusterForCues(
          buf,
          el,
          subTracks,
          timecodeScale,
          infoByTrack,
          assEventsByTrack,
          pgsBlocksByTrack,
          seenCueIdsByTrack,
          results,
        );
        if (added) cuesAdded = true;
      }
      offset = rawEnd;
    }
    // Log first time we see clusters + every 100 clusters.
    if (cuesAdded && (clusterCount <= 3 || clusterCount % 100 === 0)) {
      // eslint-disable-next-line no-console
      console.info(
        `[subs] feedChunk: chunks=${totalChunks} clusters=${clusterCount} ` +
        `totals=${results.map((r) => `${r.id}=${r.cues.length}`).join(",")}`,
      );
    }
    if (cuesAdded) opts.onProgress?.(results);
    return cuesAdded;
  };

  const finalize = () => {
    if (finalized) return;
    finalized = true;
    leftover = null;
    for (const r of results) {
      if (!isAssCodec(r.codecId)) {
        finalizeCues(r.cues);
      }
      if (r.assSource) {
        r.assSourceComplete = true;
      }
      // PGS: turn the accumulated Display Set bytes into renderable
      // compositions. Done once at the end so back-to-back cues that share
      // a paletted-update get paired correctly. Sort key is the block
      // timestamp, which buildPgsCompositions already preserves.
      if (r.pgsCompositions != null) {
        const trackNumber = parsePgsTrackNumberFromId(r.id);
        const blocks = trackNumber != null ? pgsBlocksByTrack.get(trackNumber) : undefined;
        if (blocks && blocks.length > 0) {
          blocks.sort((a, b) => a.start - b.start);
          r.pgsCompositions = buildPgsCompositions(blocks);
        }
        r.pgsCompositionsComplete = true;
      }
    }
    // eslint-disable-next-line no-console
    console.info(
      `[subs] finalize: chunks=${totalChunks} clusters=${clusterCount} ` +
      `final=${results.map((r) => `${r.id}=${r.cues.length}`).join(",")}`,
    );
    opts.onProgress?.(results);
  };

  return {
    subs: results,
    audioTracks,
    headerBuf,
    fileSize,
    headerParsedTo,
    feedChunk,
    finalize,
  };
}

function emptyExtractResult(
  headerBuf: Uint8Array,
  fileSize: number,
): {
  subs: ExtractedMkvSub[];
  audioTracks: MkvAudioTrack[];
  headerBuf: Uint8Array;
  fileSize: number;
  headerParsedTo: number;
  feedChunk: ((data: Uint8Array) => boolean) | null;
  finalize: (() => void) | null;
} {
  return {
    subs: [],
    audioTracks: [],
    headerBuf,
    fileSize,
    headerParsedTo: 0,
    feedChunk: null,
    finalize: null,
  };
}

/** Project an MKV audio TrackEntry onto the picker-friendly shape. */
function toMkvAudioTrack(t: MkvTrack): MkvAudioTrack {
  const codecId = t.codecId;
  const normCodec = codecId.toUpperCase().replace(/\s/g, "");
  // Keep this list in sync with the codecs that mp4-generator.ts knows how to
  // pack into an init segment. Anything outside this set falls back to native
  // playback for the muxer-default track only — we can't switch INTO it
  // because we can't build a fresh fMP4 with it baked in.
  const remuxable =
    normCodec.startsWith("A_AAC") ||
    normCodec === "A_FLAC" ||
    normCodec === "A_OPUS" ||
    normCodec === "A_AC3";
  return {
    number: t.number,
    codecId,
    language: t.language || "und",
    name: t.name || "",
    label: buildAudioTrackLabel(t),
    channels: t.audioChannels,
    remuxable,
  };
}

/**
 * Pretty label for the SettingsPopover audio picker.
 *
 *   "Japanese 5.1 (FLAC)"          ← when `Name` carries the descriptive bit
 *   "English · Commentary (AAC)"   ← `Name` with channels embedded
 *   "JPN · 2.0 (Opus)"             ← fallback when `Name` is empty
 *
 * Codec is always parenthesised so the user can tell why a track may be
 * MSE-unsupported (HE-AAC / DTS / TrueHD / AC-3 / etc.) — those tracks still
 * appear in the picker so the user knows they exist even though Nyrima can't
 * remux them.
 */
function buildAudioTrackLabel(t: MkvTrack): string {
  const lang = (t.language || "und").toUpperCase();
  const codec = audioCodecLabel(t.codecId);
  const chans = t.audioChannels ? formatChannelCount(t.audioChannels) : null;
  const base = t.name
    ? chans && !t.name.includes(chans)
      ? `${t.name} · ${chans}`
      : t.name
    : chans
      ? `${lang} · ${chans}`
      : lang;
  return `${base} (${codec})`;
}

function audioCodecLabel(codecId: string): string {
  const norm = codecId.toUpperCase().replace(/\s/g, "");
  if (norm.startsWith("A_AAC")) return "AAC";
  if (norm === "A_FLAC") return "FLAC";
  if (norm === "A_OPUS") return "Opus";
  if (norm === "A_AC3") return "AC-3";
  if (norm === "A_EAC3") return "E-AC-3";
  if (norm === "A_DTS") return "DTS";
  if (norm === "A_TRUEHD") return "TrueHD";
  if (norm.startsWith("A_MPEG/L3")) return "MP3";
  return codecId.replace(/^A_/, "");
}

function formatChannelCount(n: number): string {
  if (n === 1) return "Mono";
  if (n === 2) return "2.0";
  if (n === 6) return "5.1";
  if (n === 8) return "7.1";
  return `${n}ch`;
}

function concatU8(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}



// ---------------------------------------------------------------------------
// Cluster → cues
// ---------------------------------------------------------------------------

/**
 * Walk a contiguous buffer region (e.g. the header window) and extract cues
 * from every fully-present Cluster. Partial Clusters are skipped so the
 * stream walker can pick them up clean. Returns the offset right after the
 * last complete top-level element — use this as the stream start so we
 * don't re-parse already-processed clusters or start mid-element.
 */
function parseRegionForCues(
  buf: Uint8Array,
  start: number,
  end: number,
  subTracks: MkvTrack[],
  timecodeScale: number,
  infoByTrack: Map<number, AssTrackInfo>,
  assEventsByTrack: Map<number, string[]>,
  pgsBlocksByTrack: Map<number, PgsBlock[]>,
  seenCueIdsByTrack: Map<number, Set<string>>,
  results: ExtractedMkvSub[],
): number {
  let offset = start;
  let lastCompleteEnd = start;
  const bound = Math.min(end, buf.length);
  while (offset < bound) {
    if (buf[offset] === 0x00) {
      offset++;
      lastCompleteEnd = offset;
      continue;
    }
    const el = readElement(buf, offset);
    if (!el) break;

    const rawEnd =
      el.dataLengthRaw === -1 ? Infinity : el.dataOffset + el.dataLengthRaw;
    if (rawEnd > bound) {
      // Element is partial within this region — leave it for the stream walker.
      break;
    }

    if (el.id === MKV_ID.Cluster) {
      parseClusterForCues(
        buf,
        el,
        subTracks,
        timecodeScale,
        infoByTrack,
        assEventsByTrack,
        pgsBlocksByTrack,
        seenCueIdsByTrack,
        results,
      );
    }
    offset = rawEnd;
    lastCompleteEnd = rawEnd;
  }
  return lastCompleteEnd;
}

/**
 * Extract subtitle cues from a single Cluster. Returns whether any cues were
 * actually appended (so the caller can decide whether to emit progress).
 */
function parseClusterForCues(
  buf: Uint8Array,
  clusterEl: EbmlElement,
  subTracks: MkvTrack[],
  timecodeScale: number,
  infoByTrack: Map<number, AssTrackInfo>,
  assEventsByTrack: Map<number, string[]>,
  pgsBlocksByTrack: Map<number, PgsBlock[]>,
  seenCueIdsByTrack: Map<number, Set<string>>,
  results: ExtractedMkvSub[],
): boolean {
  let clusterTimeTicks = 0;
  let added = false;
  const clusterEnd = Math.min(
    buf.length,
    clusterEl.dataOffset + clusterEl.dataLength,
  );

  for (const child of iterateElements(buf, clusterEl.dataOffset, clusterEnd)) {
    if (child.id === MKV_ID.Timecode) {
      clusterTimeTicks = readUint(buf, child.dataOffset, child.dataLength);
      continue;
    }
    if (child.id === MKV_ID.SimpleBlock) {
      const block = parseSimpleBlock(buf, child.dataOffset, child.dataLength);
      const track = findTrack(subTracks, block.trackNumber);
      if (!track) continue;
      if (isPgsTrack(track.codecId)) {
        appendPgsBlock(
          pgsBlocksByTrack,
          track.number,
          block.data,
          clusterTimeTicks + block.timecode,
          timecodeScale,
        );
        added = true;
        continue;
      }
      const decoded = blockToCue(
        block.data,
        track.codecId,
        clusterTimeTicks + block.timecode,
        timecodeScale,
        null,
        infoByTrack.get(track.number) ?? EMPTY_TRACK_INFO,
      );
      if (decoded) {
        const appended = appendCue(
          results,
          track.number,
          decoded,
          assEventsByTrack,
          seenCueIdsByTrack,
        );
        if (appended) added = true;
      }
      continue;
    }
    if (child.id === MKV_ID.BlockGroup) {
      let blockDurationTicks: number | null = null;
      let blockDataEl: EbmlElement | null = null;
      for (const bgChild of iterateElements(
        buf,
        child.dataOffset,
        Math.min(buf.length, child.dataOffset + child.dataLength),
      )) {
        if (bgChild.id === MKV_ID.Block) blockDataEl = bgChild;
        if (bgChild.id === MKV_ID.BlockDuration) {
          blockDurationTicks = readUint(
            buf,
            bgChild.dataOffset,
            bgChild.dataLength,
          );
        }
      }
      if (!blockDataEl) continue;
      const block = parseBlock(
        buf,
        blockDataEl.dataOffset,
        blockDataEl.dataLength,
      );
      const track = findTrack(subTracks, block.trackNumber);
      if (!track) continue;
      if (isPgsTrack(track.codecId)) {
        appendPgsBlock(
          pgsBlocksByTrack,
          track.number,
          block.data,
          clusterTimeTicks + block.timecode,
          timecodeScale,
        );
        added = true;
        continue;
      }
      const durationSec =
        blockDurationTicks !== null
          ? ticksToSec(blockDurationTicks, timecodeScale)
          : null;
      const decoded = blockToCue(
        block.data,
        track.codecId,
        clusterTimeTicks + block.timecode,
        timecodeScale,
        durationSec,
        infoByTrack.get(track.number) ?? EMPTY_TRACK_INFO,
      );
      if (decoded) {
        const appended = appendCue(
          results,
          track.number,
          decoded,
          assEventsByTrack,
          seenCueIdsByTrack,
        );
        if (appended) added = true;
      }
    }
  }

  return added;
}

function isPgsTrack(codecId: string): boolean {
  return codecId.toUpperCase().replace(/\s/g, "") === "S_HDMV/PGS";
}

function appendPgsBlock(
  pgsBlocksByTrack: Map<number, PgsBlock[]>,
  trackNumber: number,
  data: Uint8Array,
  timeTicks: number,
  timecodeScale: number,
): void {
  const list = pgsBlocksByTrack.get(trackNumber);
  if (!list) return;
  // Trim trailing nulls — some muxers pad the block to align cluster sizes.
  let end = data.length;
  while (end > 0 && data[end - 1] === 0) end--;
  if (end === 0) return;
  list.push({
    start: ticksToSec(timeTicks, timecodeScale),
    bytes: data.subarray(0, end).slice(),
  });
}

function parsePgsTrackNumberFromId(id: string): number | null {
  // ExtractedMkvSub.id is `mkv-${trackNumber}-${language}`. We need the
  // middle field to look the track up in pgsBlocksByTrack during finalize.
  const m = id.match(/^mkv-(\d+)-/);
  return m ? Number(m[1]) : null;
}

function findTrack(
  subTracks: MkvTrack[],
  trackNumber: number,
): MkvTrack | undefined {
  for (const t of subTracks) {
    if (t.number === trackNumber) return t;
  }
  return undefined;
}

function appendCue(
  results: ExtractedMkvSub[],
  trackNumber: number,
  decoded: DecodedCue,
  assEventsByTrack: Map<number, string[]>,
  seenCueIdsByTrack: Map<number, Set<string>>,
): boolean {
  // Track number is encoded into the id: `mkv-${number}-${lang}`.
  const seen = seenCueIdsByTrack.get(trackNumber);
  // Cue id is deterministic (`${startSec.toFixed(3)}-${text.slice(0, 20)}`),
  // so any second feed of the same block — most commonly the MSE controller
  // re-handing the header's cluster region to onRawChunk after
  // parseRegionForCues already walked it — hits the dedup set here.
  if (seen && seen.has(decoded.cue.id)) return false;

  for (const r of results) {
    if (r.id.startsWith(`mkv-${trackNumber}-`)) {
      seen?.add(decoded.cue.id);
      r.cues.push(decoded.cue);
      if (decoded.assDialogue && r.assSource) {
        const events = assEventsByTrack.get(trackNumber);
        if (events) {
          events.push(decoded.assDialogue);
          r.assSource = buildAssSource(r.assHeader ?? r.assSource, events);
        }
      }
      return true;
    }
  }
  return false;
}

function ticksToSec(ticks: number, timecodeScale: number): number {
  return (ticks * timecodeScale) / 1e9;
}

function finalizeCues(cues: SubCue[]): void {
  if (cues.length < 2) return;
  cues.sort((a, b) => a.start - b.start);
  for (let i = 0; i < cues.length - 1; i++) {
    if (cues[i].end > cues[i + 1].start) {
      cues[i].end = Math.max(cues[i].start + 0.1, cues[i + 1].start - 0.05);
    }
  }
}

function trackLabelFromCodec(codecId: string, lang: string): string {
  const base = codecId.replace(/^S_TEXT\//i, "").toUpperCase();
  const langUpper = lang.toUpperCase();
  return `${langUpper} · ${base}`;
}

function isAssCodec(codecId: string): boolean {
  // Lenient match: some muxers emit non-canonical CodecID strings (`S_ASS`,
  // `ASS`, `S_TEXT/SSA-something`). All of those still carry ASS/SSA bytes,
  // so we accept anything that contains the substring after normalisation.
  const normCodec = codecId.toUpperCase().replace(/\s/g, "");
  return normCodec.includes("ASS") || normCodec.includes("SSA");
}

// ---------------------------------------------------------------------------
// ASS CodecPrivate parsing
// ---------------------------------------------------------------------------

interface AssStyleMap {
  [name: string]: SubStyles;
}

/**
 * Authoritative per-track ASS info, derived from CodecPrivate.
 *
 *  - `styles`: name → SubStyles, from the [V4+ Styles] section.
 *  - `eventTextIndex`: the column index of the `Text` field inside an
 *    MKV-form block (i.e. the original ASS Events Format with `Start` and
 *    `End` stripped and `ReadOrder` prepended). `null` when CodecPrivate
 *    didn't supply a parseable Events Format line — callers should then
 *    fall back to a heuristic.
 */
interface AssTrackInfo {
  /** Complete ASS/SSA script header from CodecPrivate, without dialogue rows. */
  sourceHeader: string | null;
  styles: AssStyleMap;
  eventTextIndex: number | null;
}

const EMPTY_TRACK_INFO: AssTrackInfo = {
  sourceHeader: null,
  styles: {},
  eventTextIndex: null,
};

function parseAssTrackInfo(codecPrivate?: Uint8Array): AssTrackInfo {
  if (!codecPrivate || codecPrivate.length === 0) {
    // Some MKVs ship ASS subs without a CodecPrivate (header-only encoders,
    // re-muxes that drop it). Fabricate a minimal v4+ header so JASSUB still
    // gets a parseable script — without this fallback, the player would silently
    // route the track through the CSS overlay even though libass could render
    // the dialogue lines we decode from clusters.
    return {
      sourceHeader: synthesizeMinimalAssHeader(),
      styles: {},
      eventTextIndex: 8,
    };
  }
  const text = new TextDecoder().decode(codecPrivate);
  return {
    sourceHeader: stripAssDialogueRows(text) || synthesizeMinimalAssHeader(),
    styles: parseAssStylesSection(text),
    // Default to the standard 8-column MKV-form layout when the events
    // Format line is missing or unparseable: that matches what every modern
    // fansub muxer emits, so the heuristic almost never has to kick in.
    eventTextIndex: parseAssEventsTextIndex(text) ?? 8,
  };
}

/**
 * Minimal but valid ASS v4+ script header. Used when CodecPrivate is missing
 * or empty so the JASSUB renderer always has a parseable script. Style values
 * are conservative defaults — including Alignment=2 (bottom-center) — and
 * per-cue overrides from the script still apply on top.
 */
function synthesizeMinimalAssHeader(): string {
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "PlayResX: 1920",
    "PlayResY: 1080",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    "Style: Default,Arial,52,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2.4,1.6,2,40,40,40,1",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ].join("\n");
}

function stripAssDialogueRows(source: string): string {
  return source
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => !/^\s*(Dialogue|Comment):/i.test(line))
    .join("\n")
    .trim();
}

function buildAssSource(header: string, dialogueLines: string[]): string {
  const normalized = stripAssFontReferences(header.replace(/\r\n/g, "\n").trim());
  const hasEvents = /\[Events\]/i.test(normalized);
  const withEvents = hasEvents
    ? normalized
    : `${normalized}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`;
  return dialogueLines.length === 0
    ? `${withEvents}\n`
    : `${withEvents}\n${dialogueLines.join("\n")}\n`;
}

function parseAssStylesSection(text: string): AssStyleMap {
  const styles: AssStyleMap = {};
  // Accept all common section spellings: `[V4 Styles]`, `[V4+ Styles]`,
  // `[V4Styles]` with arbitrary surrounding whitespace.
  const sectionMatch = text.match(
    /\[\s*V4\+?\s*Styles\s*\]([\s\S]+?)(?=\n\s*\[|$)/i,
  );
  if (!sectionMatch) return styles;

  const lines = sectionMatch[1].split(/\r?\n/);
  let formatCols: string[] = [];

  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("Format:")) {
      formatCols = line
        .slice("Format:".length)
        .split(",")
        .map((s) => s.trim().toLowerCase());
      continue;
    }
    if (!line.startsWith("Style:")) continue;
    const fields = line.slice("Style:".length).split(",");
    const style: SubStyles = {};
    let name = "";
    for (let i = 0; i < Math.min(fields.length, formatCols.length); i++) {
      const col = formatCols[i];
      const val = fields[i].trim();
      if (col === "name") name = val;
      if (col === "fontsize") style.fontSize = `${parseFloat(val) * 0.75}pt`;
      if (col === "bold") style.bold = parseInt(val, 10) !== 0;
      if (col === "italic") style.italic = parseInt(val, 10) !== 0;
      if (col === "underline") style.underline = parseInt(val, 10) !== 0;
      if (col === "primarycolour") {
        const c = parseAssColor(val);
        if (c) style.color = c;
      }
      if (col === "alignment") {
        const an = parseInt(val, 10);
        const placement = alignmentToPlacement(an);
        if (placement) {
          style.align = placement.align;
          style.linePosition = placement.linePosition;
        }
      }
    }
    if (name) styles[name] = style;
  }
  return styles;
}

/**
 * Read the Events `Format:` line and compute the column index of `Text`
 * inside an MKV-form block. The MKV/Matroska spec strips `Start`/`End`
 * from the original ASS Events row (timing comes from the cluster/block)
 * and prepends a `ReadOrder` integer, so the mapping is:
 *
 *   originalIdx − (start before? 1 : 0) − (end before? 1 : 0) + 1
 */
function parseAssEventsTextIndex(text: string): number | null {
  // ASS section header is just `[Events]` — accept whitespace variants and the
  // rare `[V4 Events]` / `[V4+ Events]` form some legacy SSA muxers emit.
  const sectionMatch = text.match(
    /\[\s*(?:V4\+?\s*)?Events\s*\]([\s\S]+?)(?=\n\s*\[|$)/i,
  );
  if (!sectionMatch) return null;
  const lines = sectionMatch[1].split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("Format:")) continue;
    const cols = line
      .slice("Format:".length)
      .split(",")
      .map((s) => s.trim().toLowerCase());

    const textOrigIdx = cols.indexOf("text");
    if (textOrigIdx < 0) return null;
    const startIdx = cols.indexOf("start");
    const endIdx = cols.indexOf("end");

    let mapped = textOrigIdx;
    if (startIdx >= 0 && startIdx < textOrigIdx) mapped -= 1;
    if (endIdx >= 0 && endIdx < textOrigIdx) mapped -= 1;
    // ReadOrder is prepended at index 0
    mapped += 1;
    return mapped;
  }
  return null;
}

function parseAssColor(val: string): string | null {
  // ASS colour: &HAABBGGRR or &HBBGGRR or decimal
  const m = val.match(/&H([0-9A-Fa-f]{2})?([0-9A-Fa-f]{6})&?/);
  if (m) {
    const bbggrr = m[2];
    const r = bbggrr.slice(4, 6);
    const g = bbggrr.slice(2, 4);
    const b = bbggrr.slice(0, 2);
    return `#${r}${g}${b}`;
  }
  const dec = parseInt(val, 10);
  if (!isNaN(dec) && dec >= 0) {
    const hex = dec.toString(16).padStart(8, "0");
    return `#${hex.slice(6)}${hex.slice(4, 6)}${hex.slice(2, 4)}`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Block payload → SubCue
// ---------------------------------------------------------------------------

interface DecodedCue {
  cue: SubCue;
  assDialogue?: string;
}

function blockToCue(
  data: Uint8Array,
  codecId: string,
  timeTicks: number,
  timecodeScale: number,
  durationSec: number | null,
  info: AssTrackInfo,
): DecodedCue | null {
  const startSec = ticksToSec(timeTicks, timecodeScale);
  const endSec = startSec + (durationSec ?? 3);
  const decoded = decodeBlockText(data, codecId, info.eventTextIndex);
  if (!decoded) return null;
  const { text, styleName } = decoded;

  const styles: SubStyles | undefined =
    styleName && info.styles[styleName] ? info.styles[styleName] : undefined;

  return {
    cue: {
      id: `${startSec.toFixed(3)}-${text.slice(0, 20)}`,
      start: startSec,
      end: endSec,
      text,
      styles,
    },
    assDialogue: buildAssDialogue(data, codecId, startSec, endSec),
  };
}

interface DecodedBlock {
  text: string;
  /** ASS Style name (4th field on the standard layout) when detectable. */
  styleName: string | null;
}

function decodeBlockText(
  data: Uint8Array,
  codecId: string,
  eventTextIndex: number | null,
): DecodedBlock | null {
  const normCodec = codecId.toUpperCase().replace(/\s/g, "");

  // Image-based — can't extract text
  if (normCodec === "S_VOBSUB" || normCodec === "S_HDMV/PGS") {
    return null;
  }

  const payload = decodeTrimmedBlockText(data);
  if (!payload) return null;
  let text = payload;

  if (normCodec === "S_TEXT/ASS" || normCodec === "S_TEXT/SSA") {
    // Full-line `Dialogue:` form: appears in external .ass files, rarely
    // in MKV blocks. Strip the prefix and let the field-index logic below
    // extract the Text column.
    let isFullDialogue = false;
    if (text.startsWith("Dialogue:")) {
      text = text.slice("Dialogue:".length).trim();
      isFullDialogue = true;
    }

    // The CodecPrivate Events Format is authoritative — use the column
    // index it told us about. For MKV-form, that's already the index
    // after Start/End strip + ReadOrder prepend. For a full Dialogue:
    // line, we need the original (un-mapped) Text index instead:
    // textOrigIdx = eventTextIndex - 1 (un-prepend ReadOrder)
    //   + (start before? 1) + (end before? 1)
    // For the standard 10-column Format the result is 9 (Text last) — but
    // we don't know that here, so for full-Dialogue we just take the last
    // field after enough commas.
    const parts = text.split(",");
    let textIdx: number;
    if (eventTextIndex !== null && !isFullDialogue) {
      textIdx = eventTextIndex;
    } else if (parts.length >= 10) {
      // ReadOrder,Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
      textIdx = 9;
    } else if (parts.length >= 9) {
      // Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
      // OR MKV-form: ReadOrder,Layer,Style,Name,MarginL,MarginR,MarginV,Effect,Text
      textIdx = 8;
    } else if (parts.length >= 8) {
      textIdx = 7;
    } else {
      // Unknown format; treat the whole thing as text.
      return { text: stripAssTags(text), styleName: null };
    }

    // Style name is the field right before MarginL on the standard layout.
    // For the MKV-form (ReadOrder,Layer,Style,...), Style is at index 2.
    // For Dialogue: form (Layer,Start,End,Style,...), Style is at index 3.
    // Easiest reliable heuristic: Style is 5 fields before Text in both
    // MKV-form (8-2=6→Style at index 2) and standard Dialogue form
    // (9-2=7? actually 9-6=3 for Dialogue). Use a layout-aware rule:
    //   - eventTextIndex provided → MKV-form → Style at textIdx - 6
    //   - Dialogue: form → Style at index 3
    let styleName: string | null = null;
    let styleIdx: number;
    if (isFullDialogue) {
      styleIdx = 3;
    } else {
      styleIdx = textIdx - 6;
    }
    if (styleIdx >= 0 && styleIdx < parts.length) {
      const sn = parts[styleIdx]?.trim();
      if (sn) styleName = sn;
    }

    const dialogueText = parts.slice(textIdx).join(",").trim();
    // Cues that the script hides via \alpha&HFF& or \fade(255,255,…) are
    // libass-only warnings (Arid-style "your player doesn't support this"
    // lines). We render through CSS during streaming, which strips the
    // hide-tag, so without this gate the warning becomes visible bare text.
    // Libass itself parses the raw ASS source — it doesn't use this list.
    if (isAssCueHidden(dialogueText)) return null;
    return { text: stripAssTags(dialogueText), styleName };
  }

  // UTF-8 / plain text / unknown
  return {
    text: text.trim().replace(/<[^>]+>/g, ""),
    styleName: null,
  };
}

function decodeTrimmedBlockText(data: Uint8Array): string | null {
  // Trim trailing nulls.
  let end = data.length;
  while (end > 0 && data[end - 1] === 0) end--;
  const trimmed = data.subarray(0, end);
  if (trimmed.length === 0) return null;

  // Matroska ASS blocks may start with a 2-byte binary ReadOrder prefix
  // (uint16 LE). If the first byte is non-printable, skip those bytes.
  const text =
    trimmed.length > 2 && trimmed[0] < 0x20
      ? new TextDecoder().decode(trimmed.subarray(2))
      : new TextDecoder().decode(trimmed);
  return text.trim();
}

function buildAssDialogue(
  data: Uint8Array,
  codecId: string,
  startSec: number,
  endSec: number,
): string | undefined {
  if (!isAssCodec(codecId)) return undefined;
  const payload = decodeTrimmedBlockText(data);
  if (!payload) return undefined;

  const start = secToAssTime(startSec);
  const end = secToAssTime(endSec);

  if (/^Dialogue:/i.test(payload)) {
    const fields = payload.replace(/^Dialogue:\s*/i, "").split(",");
    if (fields.length < 3) return undefined;
    fields[1] = start;
    fields[2] = end;
    return `Dialogue: ${fields.join(",")}`;
  }

  const fields = payload.split(",");
  // Matroska stores ASS events without Start/End and with ReadOrder
  // prepended: ReadOrder, Layer, Style, Name, MarginL, MarginR, MarginV,
  // Effect, Text. Reinsert Start/End after Layer so libass receives a
  // normal ASS Dialogue row.
  if (fields.length < 9) return undefined;
  const layer = fields[1]?.trim() || "0";
  const rest = fields.slice(2);
  return `Dialogue: ${[layer, start, end, ...rest].join(",")}`;
}

function secToAssTime(sec: number): string {
  const safe = Math.max(0, sec);
  const totalCentiseconds = Math.round(safe * 100);
  const cs = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
