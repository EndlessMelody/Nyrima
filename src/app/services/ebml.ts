/**
 * Minimal EBML / Matroska parser for browser environments.
 *
 * Designed specifically for Nyrima's needs:
 *   - Parse MKV headers to discover subtitle tracks
 *   - Extract subtitle cues from Clusters
 *   - Works with ArrayBuffers fetched via HTTP Range requests
 *
 * Only implements the subset of EBML/Matroska needed for subtitle extraction.
 */

// ---------------------------------------------------------------------------
// VINT (Variable Integer) decoding
// ---------------------------------------------------------------------------

function vintLength(firstByte: number): number {
  if (firstByte === 0) throw new Error("Invalid EBML VINT: leading zero byte");
  let len = 1;
  let mask = 0x80;
  while ((firstByte & mask) === 0) {
    len++;
    mask >>= 1;
    if (len > 8) throw new Error("Invalid EBML VINT: > 8 bytes");
  }
  return len;
}

function maskForLength(len: number): number {
  return 0x80 >> (len - 1);
}

export function readVint(
  buf: Uint8Array,
  offset: number,
): { value: number; length: number } {
  const first = buf[offset];
  const len = vintLength(first);
  const mask = maskForLength(len);
  let value = first & (mask - 1);
  for (let i = 1; i < len; i++) {
    value = (value << 8) | buf[offset + i];
  }
  return { value, length: len };
}

/**
 * Read an Element ID VINT — retains the VINT marker bits.
 *
 * EBML Element IDs include their leading marker bit as part of the ID value
 * (unlike Data Sizes where the marker is stripped). For example, the EBML
 * header ID is 0x1A45DFA3 — the 0x10 bit in the first byte is the marker
 * that indicates a 4-byte VINT, but it's also part of the canonical ID.
 */
function readElementId(
  buf: Uint8Array,
  offset: number,
): { value: number; length: number } {
  const first = buf[offset];
  const len = vintLength(first);
  let value = first; // keep marker bit intact
  for (let i = 1; i < len; i++) {
    value = (value << 8) | buf[offset + i];
  }
  return { value, length: len };
}

/** Read a signed VINT (used for Element Data Size with unknown-size marker). */
function readDataSize(
  buf: Uint8Array,
  offset: number,
): { value: number; length: number } {
  const res = readVint(buf, offset);
  // In EBML, all-ones in the value bits means "unknown size".
  // For a N-byte VINT there are (N*7) value bits, so max = 2^(N*7) - 1.
  const maxVal = (1 << (res.length * 7)) - 1;
  if (res.value >= maxVal) {
    // Unknown size — treat as "rest of buffer"
    return { value: -1, length: res.length };
  }
  return res;
}

// ---------------------------------------------------------------------------
// Element IDs we care about
// ---------------------------------------------------------------------------

export const MKV_ID = {
  EBML: 0x1a45dfa3,
  Segment: 0x18538067,
  SeekHead: 0x114d9b74,
  Info: 0x1549a966,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  TrackNumber: 0xd7,
  TrackUID: 0x73c5,
  TrackType: 0x83,
  Name: 0x536e,
  Language: 0x22b59c,
  CodecID: 0x86,
  CodecPrivate: 0x63a2,
  DefaultDuration: 0x23e383,
  Cluster: 0x1f43b675,
  Timecode: 0xe7,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  BlockDuration: 0x9b,
  Cues: 0x1c53bb6b,
  Attachments: 0x1941a469,
  Chapters: 0x1043a770,
  Tags: 0x1254c367,
  Void: 0xec,
  // Video sub-elements (inside TrackEntry)
  Video: 0xe0,
  PixelWidth: 0xb0,
  PixelHeight: 0xba,
  // Audio sub-elements (inside TrackEntry)
  Audio: 0xe1,
  SamplingFrequency: 0xb5,
  Channels: 0x9f,
  BitDepth: 0x6264,
  // Info sub-elements
  TimecodeScale: 0x2ad7b1,
} as const;

// ---------------------------------------------------------------------------
// Element reader
// ---------------------------------------------------------------------------

export interface EbmlElement {
  id: number;
  dataOffset: number;
  /** Bytes of data accessible within the current buffer (clamped). */
  dataLength: number;
  elementOffset: number;
  /** Bytes of this element accessible within the current buffer (clamped). */
  elementLength: number;
  /**
   * The element's full data length as declared in its EBML size header.
   * Equals dataLength when the element fits fully in the buffer. Larger when
   * the element extends past the buffer. -1 when the size header says
   * "unknown" (all-ones VINT, used for streaming Segments).
   */
  dataLengthRaw: number;
}

export function readElement(
  buf: Uint8Array,
  offset: number,
): EbmlElement | null {
  if (offset >= buf.length) return null;

  // 0x00 is not a valid Element ID — it's zero-padding between elements.
  if (buf[offset] === 0) return null;

  // Safe ID read — check length first, catch VINT errors.
  let idLen: number;
  try {
    idLen = vintLength(buf[offset]);
  } catch {
    return null;
  }
  if (offset + idLen > buf.length) return null;
  const id = readElementId(buf, offset);

  // Safe size read.
  const sizeOffset = offset + id.length;
  if (sizeOffset >= buf.length) return null;
  let sizeLen: number;
  try {
    sizeLen = vintLength(buf[sizeOffset]);
  } catch {
    return null;
  }
  if (sizeOffset + sizeLen > buf.length) return null;
  const size = readDataSize(buf, sizeOffset);

  const dataOffset = sizeOffset + size.length;
  const dataLength =
    size.value === -1 ? Math.max(0, buf.length - dataOffset) : size.value;
  const elementLength = id.length + size.length + dataLength;
  if (dataOffset + dataLength > buf.length) {
    // Element extends past buffer — partial read (common with prefix fetch)
    return {
      id: id.value,
      dataOffset,
      dataLength: Math.max(0, buf.length - dataOffset),
      elementOffset: offset,
      elementLength: buf.length - offset,
      dataLengthRaw: size.value,
    };
  }
  return {
    id: id.value,
    dataOffset,
    dataLength,
    elementOffset: offset,
    elementLength,
    dataLengthRaw: size.value,
  };
}

/** Iterate all top-level elements inside a parent element. */
export function* iterateElements(
  buf: Uint8Array,
  start: number,
  end: number,
): Generator<EbmlElement> {
  let offset = start;
  while (offset < end && offset < buf.length) {
    const el = readElement(buf, offset);
    if (!el) break;
    if (el.dataOffset > end) break;
    // Clamp data to the requested end boundary
    const clampedLength = Math.min(el.dataLength, end - el.dataOffset);
    yield {
      ...el,
      dataLength: clampedLength,
      elementLength: el.elementLength - (el.dataLength - clampedLength),
    };
    offset += el.elementLength;
  }
}

/** Read an unsigned integer element. */
export function readUint(
  buf: Uint8Array,
  offset: number,
  length: number,
): number {
  let value = 0;
  for (let i = 0; i < length; i++) {
    value = (value << 8) | buf[offset + i];
  }
  return value;
}

/** Read a float element (4 or 8 bytes). */
export function readFloat(
  buf: Uint8Array,
  offset: number,
  length: number,
): number {
  if (length === 4) {
    const view = new DataView(buf.buffer, buf.byteOffset + offset, 4);
    return view.getFloat32(0, false);
  }
  if (length === 8) {
    const view = new DataView(buf.buffer, buf.byteOffset + offset, 8);
    return view.getFloat64(0, false);
  }
  return 0;
}

/** Read a string element. */
export function readString(
  buf: Uint8Array,
  offset: number,
  length: number,
): string {
  const slice = buf.subarray(offset, offset + length);
  // Remove trailing nulls common in MKV strings
  let end = slice.length;
  while (end > 0 && slice[end - 1] === 0) end--;
  return new TextDecoder().decode(slice.subarray(0, end));
}

// ---------------------------------------------------------------------------
// Matroska-specific helpers
// ---------------------------------------------------------------------------

export interface MkvTrack {
  number: number;
  type: number;
  codecId: string;
  language: string;
  name: string;
  codecPrivate?: Uint8Array;
}

export const TRACK_TYPE_VIDEO = 1;
export const TRACK_TYPE_AUDIO = 2;
export const TRACK_TYPE_COMPLEX = 3;
export const TRACK_TYPE_LOGO = 0x10;
export const TRACK_TYPE_SUBTITLE = 0x11;
export const TRACK_TYPE_BUTTONS = 0x12;
export const TRACK_TYPE_CONTROL = 0x20;

/** Parse the Tracks section to discover all track metadata. */
export function parseTracks(
  buf: Uint8Array,
  tracksEl: EbmlElement,
): MkvTrack[] {
  const tracks: MkvTrack[] = [];
  for (const entry of iterateElements(
    buf,
    tracksEl.dataOffset,
    tracksEl.dataOffset + tracksEl.dataLength,
  )) {
    if (entry.id !== MKV_ID.TrackEntry) continue;
    const track: Partial<MkvTrack> = { language: "und", name: "" };
    for (const field of iterateElements(
      buf,
      entry.dataOffset,
      entry.dataOffset + entry.dataLength,
    )) {
      switch (field.id) {
        case MKV_ID.TrackNumber:
          track.number = readUint(buf, field.dataOffset, field.dataLength);
          break;
        case MKV_ID.TrackType:
          track.type = readUint(buf, field.dataOffset, field.dataLength);
          break;
        case MKV_ID.CodecID:
          track.codecId = readString(buf, field.dataOffset, field.dataLength);
          break;
        case MKV_ID.Language:
          track.language = readString(buf, field.dataOffset, field.dataLength);
          break;
        case MKV_ID.Name:
          track.name = readString(buf, field.dataOffset, field.dataLength);
          break;
        case MKV_ID.CodecPrivate:
          track.codecPrivate = buf.subarray(
            field.dataOffset,
            field.dataOffset + field.dataLength,
          );
          break;
      }
    }
    if (
      track.number !== undefined &&
      track.type !== undefined &&
      track.codecId
    ) {
      tracks.push(track as MkvTrack);
    }
  }
  return tracks;
}

/** Parse a SimpleBlock to extract track number, timecode, flags, and payload. */
export interface SimpleBlock {
  trackNumber: number;
  timecode: number; // ms relative to cluster timecode
  keyframe: boolean;
  data: Uint8Array;
}

export function parseSimpleBlock(
  buf: Uint8Array,
  offset: number,
  length: number,
): SimpleBlock {
  // Track number uses a shorter VINT encoding inside SimpleBlock
  const trackVint = readVint(buf, offset);
  const trackNumber = trackVint.value;
  const tcOffset = offset + trackVint.length;
  const view = new DataView(buf.buffer, buf.byteOffset + tcOffset, 2);
  const timecode = view.getInt16(0, false); // signed, in ms
  const flags = buf[tcOffset + 2];
  const dataOffset = tcOffset + 3;
  const data = buf.subarray(dataOffset, offset + length);
  return {
    trackNumber,
    timecode,
    keyframe: (flags & 0x80) !== 0,
    data,
  };
}

/** Parse a Block (inside BlockGroup) — same layout as SimpleBlock. */
export function parseBlock(
  buf: Uint8Array,
  offset: number,
  length: number,
): SimpleBlock {
  return parseSimpleBlock(buf, offset, length);
}

// ---------------------------------------------------------------------------
// High-level: find Segment and Tracks in a buffer
// ---------------------------------------------------------------------------

export interface MkvHeaderResult {
  segmentOffset: number;
  segmentLength: number;
  tracks?: MkvTrack[];
  infoDuration?: number; // ms
  /**
   * TimecodeScale in nanoseconds (default 1,000,000 = 1 ms).
   * Every cluster timecode, block timecode, and BlockDuration is expressed in
   * units of TimecodeScale nanoseconds. Multiply by timecodeScale/1e6 to get
   * milliseconds.
   */
  timecodeScale: number;
}

export function parseMkvHeader(buf: Uint8Array): MkvHeaderResult {
  // First element should be EBML
  const ebml = readElement(buf, 0);
  if (!ebml || ebml.id !== MKV_ID.EBML) {
    throw new Error("Not a valid MKV/EBML file");
  }

  // Skip any Void or CRC-32 elements between EBML and Segment
  let segOffset = ebml.elementLength;
  while (segOffset < buf.length) {
    const candidate = readElement(buf, segOffset);
    if (!candidate) break;
    if (candidate.id === MKV_ID.Segment) {
      const segment = candidate;
      const result: MkvHeaderResult = {
        segmentOffset: segment.dataOffset,
        segmentLength:
          segment.dataLength === -1
            ? Math.max(0, buf.length - segment.dataOffset)
            : segment.dataLength,
        timecodeScale: 1_000_000, // default per Matroska spec
      };

      // Scan top-level children of Segment for Tracks and Info
      const segEnd = Math.min(
        buf.length,
        segment.dataOffset + result.segmentLength,
      );
      for (const el of iterateElements(buf, segment.dataOffset, segEnd)) {
        if (el.id === MKV_ID.Tracks) {
          result.tracks = parseTracks(buf, el);
        }
        if (el.id === MKV_ID.Info) {
          for (const infoEl of iterateElements(
            buf,
            el.dataOffset,
            Math.min(buf.length, el.dataOffset + el.dataLength),
          )) {
            if (infoEl.id === 0x4489) {
              // Duration element ID
              const durationSec = readFloat(
                buf,
                infoEl.dataOffset,
                infoEl.dataLength,
              );
              if (durationSec > 0) {
                result.infoDuration = Math.floor(durationSec * 1000);
              }
            }
            if (infoEl.id === MKV_ID.TimecodeScale) {
              const ts = readUint(buf, infoEl.dataOffset, infoEl.dataLength);
              if (ts > 0) result.timecodeScale = ts;
            }
          }
        }
      }
      return result;
    }
    // Skip Void / CRC-32 / unknown elements
    segOffset += candidate.elementLength;
  }

  throw new Error("MKV Segment not found");
}
