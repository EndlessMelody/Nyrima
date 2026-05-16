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
  TRACK_TYPE_SUBTITLE,
  type EbmlElement,
  type MkvTrack,
} from "./ebml";
import { type SubCue, type SubStyles } from "./subtitles";
import { fetchRange } from "./drive-api";

export interface ExtractedMkvSub {
  id: string;
  lang: string;
  label: string;
  codecId: string;
  cues: SubCue[];
  imageBased: boolean;
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
  if (signal?.aborted) return { subs: [], headerBuf, fileSize, headerParsedTo: 0, feedChunk: null, finalize: null };
  opts.onHeader?.({ buf: headerBuf, fileSize });

  // 2. Parse header ---------------------------------------------------------
  let header;
  try {
    header = parseMkvHeader(headerBuf);
  } catch {
    return { subs: [], headerBuf, fileSize, headerParsedTo: 0, feedChunk: null, finalize: null };
  }
  if (!header.tracks) return { subs: [], headerBuf, fileSize, headerParsedTo: 0, feedChunk: null, finalize: null };


  const subTracks = header.tracks.filter((t) => t.type === TRACK_TYPE_SUBTITLE);
  // eslint-disable-next-line no-console
  console.info(
    `[subs] header parsed: fileSize=${fileSize} subTracks=${subTracks.length} ` +
    `tracks=${subTracks.map((t) => `#${t.number}:${t.codecId}/${t.language}`).join(",")}`,
  );
  if (subTracks.length === 0) {
    return { subs: [], headerBuf, fileSize, headerParsedTo: 0, feedChunk: null, finalize: null };
  }

  const timecodeScale = header.timecodeScale;

  // 3. Initialise per-track results + per-track ASS style maps -------------
  const results: ExtractedMkvSub[] = subTracks.map((t) => {
    const normCodec = t.codecId.toUpperCase().replace(/\s/g, "");
    const imageBased = normCodec === "S_VOBSUB" || normCodec === "S_HDMV/PGS";
    return {
      id: `mkv-${t.number}-${t.language}`,
      lang: t.language,
      label: t.name || trackLabelFromCodec(t.codecId, t.language),
      codecId: t.codecId,
      cues: [],
      imageBased,
    };
  });

  const infoByTrack = new Map<number, AssTrackInfo>();
  for (const t of subTracks) {
    infoByTrack.set(t.number, parseAssTrackInfo(t.codecPrivate));
  }

  // If every subtitle track is image-based we have nothing to extract.
  if (results.every((r) => r.imageBased)) {
    opts.onProgress?.(results);
    return { subs: results, headerBuf, fileSize, headerParsedTo: 0, feedChunk: null, finalize: null };
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
          buf, el, subTracks, timecodeScale, infoByTrack, results,
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
    for (const r of results) finalizeCues(r.cues);
    // eslint-disable-next-line no-console
    console.info(
      `[subs] finalize: chunks=${totalChunks} clusters=${clusterCount} ` +
      `final=${results.map((r) => `${r.id}=${r.cues.length}`).join(",")}`,
    );
    opts.onProgress?.(results);
  };

  return { subs: results, headerBuf, fileSize, headerParsedTo, feedChunk, finalize };
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
      const cue = blockToCue(
        block.data,
        track.codecId,
        clusterTimeTicks + block.timecode,
        timecodeScale,
        infoByTrack.get(track.number) ?? EMPTY_TRACK_INFO,
      );
      if (cue) {
        appendCue(results, track.number, cue);
        added = true;
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
      const cue = blockToCue(
        block.data,
        track.codecId,
        clusterTimeTicks + block.timecode,
        timecodeScale,
        infoByTrack.get(track.number) ?? EMPTY_TRACK_INFO,
      );
      if (cue) {
        if (blockDurationTicks !== null) {
          cue.end = cue.start + ticksToSec(blockDurationTicks, timecodeScale);
        }
        appendCue(results, track.number, cue);
        added = true;
      }
    }
  }

  return added;
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
  cue: SubCue,
): void {
  for (const r of results) {
    // Track number is encoded into the id: `mkv-${number}-${lang}`
    if (r.id.startsWith(`mkv-${trackNumber}-`)) {
      r.cues.push(cue);
      return;
    }
  }
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
  styles: AssStyleMap;
  eventTextIndex: number | null;
}

const EMPTY_TRACK_INFO: AssTrackInfo = {
  styles: {},
  eventTextIndex: null,
};

function parseAssTrackInfo(codecPrivate?: Uint8Array): AssTrackInfo {
  if (!codecPrivate || codecPrivate.length === 0) return EMPTY_TRACK_INFO;
  const text = new TextDecoder().decode(codecPrivate);

  return {
    styles: parseAssStylesSection(text),
    eventTextIndex: parseAssEventsTextIndex(text),
  };
}

function parseAssStylesSection(text: string): AssStyleMap {
  const styles: AssStyleMap = {};
  const sectionMatch = text.match(/\[V4\+?\s*Styles\](.+?)(?=\[|$)/is);
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
        const align = parseInt(val, 10);
        if (align >= 1 && align <= 3) style.align = "left";
        if (align >= 4 && align <= 6) style.align = "center";
        if (align >= 7 && align <= 9) style.align = "right";
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
  const sectionMatch = text.match(/\[V4\+?\s*Events\](.+?)(?=\[|$)/is);
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

function blockToCue(
  data: Uint8Array,
  codecId: string,
  timeTicks: number,
  timecodeScale: number,
  info: AssTrackInfo,
): SubCue | null {
  const startSec = ticksToSec(timeTicks, timecodeScale);
  const decoded = decodeBlockText(data, codecId, info.eventTextIndex);
  if (!decoded) return null;
  const { text, styleName } = decoded;

  const styles: SubStyles | undefined =
    styleName && info.styles[styleName] ? info.styles[styleName] : undefined;

  return {
    id: `${startSec.toFixed(3)}-${text.slice(0, 20)}`,
    start: startSec,
    end: startSec + 3, // overridden by BlockDuration when present
    text,
    styles,
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
  // Trim trailing nulls
  let end = data.length;
  while (end > 0 && data[end - 1] === 0) end--;
  const trimmed = data.subarray(0, end);
  if (trimmed.length === 0) return null;

  const normCodec = codecId.toUpperCase().replace(/\s/g, "");

  // Image-based — can't extract text
  if (normCodec === "S_VOBSUB" || normCodec === "S_HDMV/PGS") {
    return null;
  }

  let text = new TextDecoder().decode(trimmed);

  if (normCodec === "S_TEXT/ASS" || normCodec === "S_TEXT/SSA") {
    // Matroska ASS blocks may start with a 2-byte ReadOrder prefix
    // (uint16 LE). If the first byte is non-printable, skip the first 2.
    if (trimmed.length > 2 && trimmed[0] < 0x20) {
      text = new TextDecoder().decode(trimmed.subarray(2)).trim();
    } else {
      text = text.trim();
    }

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
    return { text: stripAssTags(dialogueText), styleName };
  }

  // UTF-8 / plain text / unknown
  return {
    text: text.trim().replace(/<[^>]+>/g, ""),
    styleName: null,
  };
}

function stripAssTags(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/\\N/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\\h/g, " ")
    .trim();
}

