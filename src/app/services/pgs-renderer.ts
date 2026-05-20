/**
 * PGS (Presentation Graphic Stream) decoder for Blu-ray subtitles.
 *
 * Blu-ray rips carry subtitles as RLE-compressed bitmaps in `S_HDMV/PGS`
 * tracks rather than as text. This module turns the raw segment bytes
 * stored in MKV blocks into time-coded RGBA bitmaps that PgsOverlay can
 * paint on a canvas synced to the video's `currentTime`.
 *
 * Why decode in JS rather than OCR:
 *   - Fansub typesetting (signs, styled credits, mixed fonts) is the whole
 *     reason to keep PGS over OCR — the artwork is the message.
 *   - libpgs/pgs-js are small, deterministic, and ship no WASM.
 *
 * Pipeline:
 *   1. mkv-subtitles.ts feeds us `{ start, bytes }` per MKV block. The bytes
 *      are a sequence of PGS segments (PCS, WDS, PDS, ODS, END).
 *   2. `buildPgsCompositions` walks the per-block stream, accumulating
 *      Display Sets. A composition with objects opens a cue; a composition
 *      with zero objects (or the next epoch start) closes the previous one.
 *   3. Each composition's objects are RLE-decoded once and stored as RGBA
 *      `Uint8ClampedArray`s. PgsOverlay calls `putImageData` on its canvas.
 *
 * Memory budget: bitmaps are kept decoded in memory after parsing. A 1080p
 * episode rarely exceeds 30–60 MB of RGBA — much less than a single VP9
 * keyframe, so we don't bother with on-demand decoding yet.
 */

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PgsComposition {
  /** Seconds — from the MKV block timecode that owned the opening PCS. */
  start: number;
  /** Seconds — filled in by the next "empty" composition or end-of-stream. */
  end: number;
  /** Display resolution declared by PCS — the bitmap positions are in this
   *  coordinate space. PgsOverlay scales by `clientWidth / videoWidth`. */
  videoWidth: number;
  videoHeight: number;
  objects: PgsCompositionObject[];
}

export interface PgsCompositionObject {
  /** Top-left position in PCS coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Pre-decoded RGBA pixels (width * height * 4). Safe to feed into
   *  `new ImageData(...)`. */
  rgba: Uint8ClampedArray;
}

// ---------------------------------------------------------------------------
// Segment types
// ---------------------------------------------------------------------------

const SEG_PDS = 0x14;
const SEG_ODS = 0x15;
const SEG_PCS = 0x16;
const SEG_WDS = 0x17;
const SEG_END = 0x80;

interface PaletteEntry {
  y: number;
  cr: number;
  cb: number;
  a: number;
}

type Palette = Map<number, PaletteEntry>;

interface ParsedPcs {
  videoWidth: number;
  videoHeight: number;
  /** 0x00 normal, 0x40 acquisition, 0x80 epoch start. */
  compositionState: number;
  paletteId: number;
  objects: Array<{
    objectId: number;
    x: number;
    y: number;
  }>;
}

interface ParsedOdsChunk {
  objectId: number;
  /** True when this chunk carries the width/height header (first or only). */
  isFirst: boolean;
  isLast: boolean;
  /** Present when `isFirst`. */
  width?: number;
  height?: number;
  /** RLE-compressed pixel data. May be partial — concatenate across chunks. */
  data: Uint8Array;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface PgsBlock {
  start: number;
  bytes: Uint8Array;
}

/**
 * Walk an entire track's worth of PGS blocks and emit a sorted list of
 * compositions ready for rendering. Errors in a single block are isolated —
 * we drop that block and keep going, since one corrupt cue shouldn't kill
 * the rest of the episode.
 */
export function buildPgsCompositions(blocks: PgsBlock[]): PgsComposition[] {
  if (blocks.length === 0) return [];

  // Per-object byte accumulator for fragmented ODS chunks. PGS allows an
  // object to span multiple ODS segments inside a single Display Set when
  // the RLE stream is larger than one segment can hold.
  const palettes = new Map<number, Palette>();
  const objectBuffers = new Map<
    number,
    { width: number; height: number; chunks: Uint8Array[] }
  >();

  const out: PgsComposition[] = [];
  let lastOpen: PgsComposition | null = null;

  for (const block of blocks) {
    let pcs: ParsedPcs | null = null;
    const odsChunks: ParsedOdsChunk[] = [];

    try {
      const segments = readSegments(block.bytes);
      for (const seg of segments) {
        if (seg.type === SEG_PDS) {
          const parsed = parsePds(seg.data);
          if (parsed) palettes.set(parsed.id, parsed.palette);
        } else if (seg.type === SEG_PCS) {
          pcs = parsePcs(seg.data);
        } else if (seg.type === SEG_ODS) {
          const ods = parseOds(seg.data);
          if (ods) odsChunks.push(ods);
        }
        // WDS / END are ignored — windows are advisory and we don't clip,
        // and END just terminates the display set.
      }
    } catch {
      continue;
    }

    if (!pcs) continue;

    // Accumulate ODS chunks per object_id so a multi-segment bitmap reads
    // back as one. We resolve to a final pixel buffer once we see the chunk
    // flagged "last in sequence".
    for (const chunk of odsChunks) {
      let entry = objectBuffers.get(chunk.objectId);
      if (chunk.isFirst) {
        entry = {
          width: chunk.width ?? 0,
          height: chunk.height ?? 0,
          chunks: [chunk.data],
        };
        objectBuffers.set(chunk.objectId, entry);
      } else if (entry) {
        entry.chunks.push(chunk.data);
      }
    }

    // An empty composition closes the previous cue (Blu-ray subtitles use
    // "show ... then show nothing" pairs). Don't open a new cue for it.
    if (pcs.objects.length === 0) {
      if (lastOpen && lastOpen.end === Infinity) lastOpen.end = block.start;
      continue;
    }

    const palette = palettes.get(pcs.paletteId);
    if (!palette) continue;

    const useBt709 = pcs.videoHeight >= 720;
    const composition: PgsComposition = {
      start: block.start,
      end: Infinity,
      videoWidth: pcs.videoWidth,
      videoHeight: pcs.videoHeight,
      objects: [],
    };

    for (const ref of pcs.objects) {
      const buf = objectBuffers.get(ref.objectId);
      if (!buf || buf.width === 0 || buf.height === 0) continue;
      const rle = concatChunks(buf.chunks);
      const rgba = decodeRleToRgba(rle, buf.width, buf.height, palette, useBt709);
      if (!rgba) continue;
      composition.objects.push({
        x: ref.x,
        y: ref.y,
        width: buf.width,
        height: buf.height,
        rgba,
      });
    }

    if (composition.objects.length === 0) continue;

    // Cap the previous cue at this one's start — Blu-ray sometimes omits the
    // explicit "clear" segment between back-to-back lines.
    if (lastOpen && lastOpen.end === Infinity) lastOpen.end = block.start;
    out.push(composition);
    lastOpen = composition;
  }

  // Anything still open at end-of-stream: leave on screen for a sensible
  // default (3 s) so the final line isn't permanently stuck.
  if (lastOpen && lastOpen.end === Infinity) {
    lastOpen.end = lastOpen.start + 3;
  }

  return out;
}

// ---------------------------------------------------------------------------
// Segment parsing
// ---------------------------------------------------------------------------

interface RawSegment {
  type: number;
  data: Uint8Array;
}

function readSegments(buf: Uint8Array): RawSegment[] {
  const out: RawSegment[] = [];
  let i = 0;
  while (i + 3 <= buf.length) {
    const type = buf[i];
    const size = (buf[i + 1] << 8) | buf[i + 2];
    const dataStart = i + 3;
    const dataEnd = dataStart + size;
    if (dataEnd > buf.length) break;
    out.push({ type, data: buf.subarray(dataStart, dataEnd) });
    i = dataEnd;
  }
  return out;
}

function parsePcs(data: Uint8Array): ParsedPcs | null {
  if (data.length < 11) return null;
  const videoWidth = (data[0] << 8) | data[1];
  const videoHeight = (data[2] << 8) | data[3];
  // data[4] = frame_rate (advisory), data[5..6] = composition_number
  const compositionState = data[7];
  // data[8] = palette_update_flag
  const paletteId = data[9];
  const objectCount = data[10];

  const objects: ParsedPcs["objects"] = [];
  let off = 11;
  for (let i = 0; i < objectCount; i++) {
    if (off + 8 > data.length) return null;
    const objectId = (data[off] << 8) | data[off + 1];
    // data[off + 2] = window_id (we ignore — windows are advisory)
    const flag = data[off + 3];
    const cropped = (flag & 0x80) !== 0;
    const x = (data[off + 4] << 8) | data[off + 5];
    const y = (data[off + 6] << 8) | data[off + 7];
    off += 8;
    if (cropped) {
      // Skip 8 bytes of cropping coords — we render the full object.
      // Anime PGS almost never crops; if it does, the result is a slightly
      // larger bitmap than intended, not a crash.
      off += 8;
    }
    objects.push({ objectId, x, y });
  }
  return { videoWidth, videoHeight, compositionState, paletteId, objects };
}

function parsePds(data: Uint8Array): { id: number; palette: Palette } | null {
  if (data.length < 2) return null;
  const id = data[0];
  // data[1] = palette_version_number
  const palette: Palette = new Map();
  for (let i = 2; i + 4 < data.length + 1; i += 5) {
    if (i + 5 > data.length) break;
    const entryId = data[i];
    const y = data[i + 1];
    const cr = data[i + 2];
    const cb = data[i + 3];
    const a = data[i + 4];
    palette.set(entryId, { y, cr, cb, a });
  }
  return { id, palette };
}

function parseOds(data: Uint8Array): ParsedOdsChunk | null {
  if (data.length < 4) return null;
  const objectId = (data[0] << 8) | data[1];
  // data[2] = object_version_number
  const lastInSequence = data[3];
  const isFirst = (lastInSequence & 0x80) !== 0;
  const isLast = (lastInSequence & 0x40) !== 0;

  if (isFirst) {
    if (data.length < 11) return null;
    // 3-byte big-endian object_data_length includes width/height fields,
    // but we ignore it — the chunk's own byte length is authoritative.
    const width = (data[7] << 8) | data[8];
    const height = (data[9] << 8) | data[10];
    return {
      objectId,
      isFirst: true,
      isLast,
      width,
      height,
      data: data.subarray(11),
    };
  }
  return {
    objectId,
    isFirst: false,
    isLast,
    data: data.subarray(4),
  };
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

// ---------------------------------------------------------------------------
// RLE → RGBA
// ---------------------------------------------------------------------------

/**
 * PGS RLE format (per US patent 7,912,305 / the de-facto spec):
 *
 *   c           c != 0           → 1 px of colour c
 *   00 00                        → end of line
 *   00 0nnnnnn                   → run of n (1..63) px of colour 0
 *   00 01nnnnnn nnnnnnnn         → run of n (64..16383) px of colour 0
 *   00 10nnnnnn c                → run of n (1..63) px of colour c
 *   00 11nnnnnn nnnnnnnn c       → run of n (64..16383) px of colour c
 */
function decodeRleToRgba(
  rle: Uint8Array,
  width: number,
  height: number,
  palette: Palette,
  useBt709: boolean,
): Uint8ClampedArray | null {
  if (width <= 0 || height <= 0) return null;
  const rgba = new Uint8ClampedArray(width * height * 4);
  // Cache the LUT lookup for the common case of repeated palette indices —
  // most lines paint the same 3–4 colours over and over.
  const lut = buildRgbaLut(palette, useBt709);

  let x = 0;
  let y = 0;
  let i = 0;
  while (i < rle.length && y < height) {
    const b1 = rle[i++];
    if (b1 !== 0) {
      writeRun(rgba, lut, x, y, width, 1, b1);
      x += 1;
      continue;
    }
    if (i >= rle.length) break;
    const b2 = rle[i++];
    if (b2 === 0) {
      // End of line
      x = 0;
      y += 1;
      continue;
    }
    const top = b2 & 0xc0;
    const lowBits = b2 & 0x3f;
    let runLength: number;
    let colour: number;
    if (top === 0x00) {
      runLength = lowBits;
      colour = 0;
    } else if (top === 0x40) {
      if (i >= rle.length) break;
      runLength = (lowBits << 8) | rle[i++];
      colour = 0;
    } else if (top === 0x80) {
      if (i >= rle.length) break;
      runLength = lowBits;
      colour = rle[i++];
    } else {
      if (i + 1 >= rle.length) break;
      runLength = (lowBits << 8) | rle[i++];
      colour = rle[i++];
    }
    writeRun(rgba, lut, x, y, width, runLength, colour);
    x += runLength;
    // Some encoders omit the `00 00` end-of-line marker and let the
    // x-overflow wrap. Snap to next line when we've painted a row.
    if (x >= width) {
      x = 0;
      y += 1;
    }
  }
  return rgba;
}

function writeRun(
  rgba: Uint8ClampedArray,
  lut: Uint8ClampedArray,
  x: number,
  y: number,
  width: number,
  runLength: number,
  colour: number,
): void {
  const start = (y * width + x) * 4;
  const lutOff = colour * 4;
  const r = lut[lutOff];
  const g = lut[lutOff + 1];
  const b = lut[lutOff + 2];
  const a = lut[lutOff + 3];
  let off = start;
  // Skip fully-transparent runs entirely — the buffer is already zeroed.
  if (a === 0) return;
  for (let n = 0; n < runLength; n++) {
    rgba[off++] = r;
    rgba[off++] = g;
    rgba[off++] = b;
    rgba[off++] = a;
  }
}

function buildRgbaLut(palette: Palette, useBt709: boolean): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (const [id, entry] of palette) {
    const { r, g, b } = ycbcrToRgb(entry.y, entry.cb, entry.cr, useBt709);
    const off = id * 4;
    lut[off] = r;
    lut[off + 1] = g;
    lut[off + 2] = b;
    lut[off + 3] = entry.a;
  }
  return lut;
}

function ycbcrToRgb(
  y: number,
  cb: number,
  cr: number,
  useBt709: boolean,
): { r: number; g: number; b: number } {
  const yp = y - 16;
  const cbp = cb - 128;
  const crp = cr - 128;
  let r: number;
  let g: number;
  let b: number;
  if (useBt709) {
    r = 1.164 * yp + 1.793 * crp;
    g = 1.164 * yp - 0.213 * cbp - 0.533 * crp;
    b = 1.164 * yp + 2.112 * cbp;
  } else {
    r = 1.164 * yp + 1.596 * crp;
    g = 1.164 * yp - 0.392 * cbp - 0.813 * crp;
    b = 1.164 * yp + 2.017 * cbp;
  }
  return { r: clamp8(r), g: clamp8(g), b: clamp8(b) };
}

function clamp8(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}
