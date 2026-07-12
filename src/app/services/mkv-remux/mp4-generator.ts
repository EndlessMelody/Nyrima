/**
 * Fragmented MP4 (ISO BMFF) box generator.
 *
 * Builds the binary structures needed to feed a MediaSource SourceBuffer:
 *   - Init segment: ftyp + moov (with avcC/hvcC for video, esds/dfLa for audio)
 *   - Media segments: moof + mdat (one per MKV Cluster)
 *
 * Supported codecs:
 *   Video: H.264 (AVC), H.265 (HEVC)
 *   Audio: AAC, FLAC, Opus, AC-3
 */

import type {
  Ac3SpecificBoxFields,
  VideoTrackInfo,
  AudioTrackInfo,
  DemuxedSample,
} from "./types";

const VIDEO_TIMESCALE = 90000;

// ---------------------------------------------------------------------------
// Low-level box builders
// ---------------------------------------------------------------------------

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function box(type: string, ...payloads: Uint8Array[]): Uint8Array {
  let payloadLen = 0;
  for (const p of payloads) payloadLen += p.length;
  const size = 8 + payloadLen;
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, size);
  out[4] = type.charCodeAt(0);
  out[5] = type.charCodeAt(1);
  out[6] = type.charCodeAt(2);
  out[7] = type.charCodeAt(3);
  let off = 8;
  for (const p of payloads) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function fullBox(
  type: string,
  version: number,
  flags: number,
  ...payloads: Uint8Array[]
): Uint8Array {
  const vf = new Uint8Array(4);
  vf[0] = version;
  vf[1] = (flags >> 16) & 0xff;
  vf[2] = (flags >> 8) & 0xff;
  vf[3] = flags & 0xff;
  return box(type, vf, ...payloads);
}

function u32(v: number): Uint8Array {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, v);
  return b;
}

function u16(v: number): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, v);
  return b;
}

function u8(v: number): Uint8Array {
  return new Uint8Array([v & 0xff]);
}

function zeros(n: number): Uint8Array {
  return new Uint8Array(n);
}

function strBytes(s: string): Uint8Array {
  const b = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
  return b;
}

// ---------------------------------------------------------------------------
// Init segment
// ---------------------------------------------------------------------------

/**
 * Multiplexed init segment (video + audio in one moov). Retained for the
 * codec-combo probe in PlayerPage and the existing unit tests. The MSE
 * controller has moved to split init segments (`generateVideoInitSegment`
 * / `generateAudioInitSegment`) so it can run two SourceBuffers and swap
 * audio in place without re-buffering the video.
 */
export function generateInitSegment(
  video: VideoTrackInfo,
  audio?: AudioTrackInfo,
): { data: Uint8Array; codecString: string } {
  const ftyp = buildFtyp();
  const moov = buildMoovCombined(video, audio);
  const codecString = buildCodecString(video, audio);
  return { data: concatBytes(ftyp, moov), codecString };
}

/**
 * Video-only init segment. The trak is at trackId=1 inside its own moov
 * — the buffer is a self-contained stream so it doesn't share IDs with
 * audio. The MSE controller appends this to its video SourceBuffer.
 */
export function generateVideoInitSegment(
  video: VideoTrackInfo,
): { data: Uint8Array; codecString: string } {
  const ftyp = buildFtyp();
  const moov = box(
    "moov",
    buildMvhd(),
    buildVideoTrak(1, video),
    buildMvex(1),
  );
  const codecString = buildVideoCodecString(video);
  return { data: concatBytes(ftyp, moov), codecString };
}

/**
 * Audio-only init segment. Same trackId=1 trick as the video segment —
 * each split SourceBuffer is an independent stream. Swapping dubs at
 * runtime feeds a fresh one of these into `audioSB.changeType(...) +
 * appendBuffer(...)` without touching the video side.
 */
export function generateAudioInitSegment(
  audio: AudioTrackInfo,
): { data: Uint8Array; codecString: string } {
  const ftyp = buildFtyp();
  const moov = box(
    "moov",
    buildMvhd(),
    buildAudioTrak(1, audio),
    buildMvex(1),
  );
  const codecString = buildAudioCodecString(audio);
  return { data: concatBytes(ftyp, moov), codecString };
}

/**
 * Returns the `video/mp4; codecs="..."` string that `MediaSource.isType
 * Supported` expects. Lets callers probe whether the browser can play a
 * given video+audio combination BEFORE we kick off the MSE pipeline —
 * crucial for catching things like Chrome refusing `hevc+ac-3` muxed
 * together even when each codec works on its own.
 *
 * With split SourceBuffers we additionally probe per-buffer mime types
 * (`buildVideoMimeType` / `buildAudioMimeType`) since combinations that
 * fail muxed sometimes succeed split.
 */
export function buildMimeType(
  video: VideoTrackInfo,
  audio?: AudioTrackInfo,
): string {
  return `video/mp4; codecs="${buildCodecString(video, audio)}"`;
}

export function buildVideoMimeType(video: VideoTrackInfo): string {
  return `video/mp4; codecs="${buildVideoCodecString(video)}"`;
}

export function buildAudioMimeType(audio: AudioTrackInfo): string {
  return `audio/mp4; codecs="${buildAudioCodecString(audio)}"`;
}

function buildFtyp(): Uint8Array {
  return box(
    "ftyp",
    strBytes("isom"),
    u32(512),
    strBytes("isom"),
    strBytes("iso2"),
    strBytes("avc1"),
    strBytes("mp41"),
  );
}

// ---------------------------------------------------------------------------
// Codec string
// ---------------------------------------------------------------------------

function buildCodecString(video: VideoTrackInfo, audio?: AudioTrackInfo): string {
  let codec = buildVideoCodecString(video);
  if (audio) codec += ", " + buildAudioCodecString(audio);
  return codec;
}

function buildVideoCodecString(video: VideoTrackInfo): string {
  if (video.codec === 'avc') {
    const cp = video.codecPrivate;
    const profile = cp[1].toString(16).padStart(2, "0");
    const compat = cp[2].toString(16).padStart(2, "0");
    const level = cp[3].toString(16).padStart(2, "0");
    return `avc1.${profile}${compat}${level}`;
  }
  return buildHevcCodecString(video.codecPrivate);
}

function buildAudioCodecString(audio: AudioTrackInfo): string {
  switch (audio.codec) {
    case 'aac':  return "mp4a.40.2";
    case 'flac': return "flac";
    case 'opus': return "opus";
    case 'ac3':  return "ac-3";
  }
}

function buildHevcCodecString(cp: Uint8Array): string {
  // HEVCDecoderConfigurationRecord layout:
  // byte 0: configurationVersion
  // byte 1: [general_profile_space(2)] [general_tier_flag(1)] [general_profile_idc(5)]
  // bytes 2-5: general_profile_compatibility_flags (32 bits BE)
  // bytes 6-11: general_constraint_indicator_flags (48 bits)
  // byte 12: general_level_idc
  const profileSpace = (cp[1] >> 6) & 0x03;
  const tierFlag = (cp[1] >> 5) & 0x01;
  const profileIdc = cp[1] & 0x1f;
  const compatFlags = ((cp[2] << 24) | (cp[3] << 16) | (cp[4] << 8) | cp[5]) >>> 0;
  const levelIdc = cp[12];

  let s = "hev1.";
  if (profileSpace === 1) s += "A";
  else if (profileSpace === 2) s += "B";
  else if (profileSpace === 3) s += "C";
  s += profileIdc.toString();
  s += "." + compatFlags.toString(16).toUpperCase();
  s += "." + (tierFlag ? "H" : "L") + levelIdc.toString();

  // Append constraint indicator bytes (trim trailing zeros)
  const constraints: number[] = [];
  for (let i = 6; i < 12; i++) constraints.push(cp[i]);
  while (constraints.length > 0 && constraints[constraints.length - 1] === 0)
    constraints.pop();
  for (const c of constraints)
    s += "." + c.toString(16).toUpperCase();

  return s;
}

// ---------------------------------------------------------------------------
// moov
// ---------------------------------------------------------------------------

function buildMoovCombined(video: VideoTrackInfo, audio?: AudioTrackInfo): Uint8Array {
  const parts: Uint8Array[] = [buildMvhd(), buildVideoTrak(1, video)];
  if (audio) parts.push(buildAudioTrak(2, audio));
  parts.push(buildMvex(audio ? 2 : 1));
  return box("moov", ...parts);
}

function buildMvhd(): Uint8Array {
  const payload = new Uint8Array(96);
  const dv = new DataView(payload.buffer);
  dv.setUint32(8, 1000);
  dv.setUint32(16, 0x00010000);
  dv.setUint16(20, 0x0100);
  const mtx = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
  for (let i = 0; i < 9; i++) dv.setUint32(32 + i * 4, mtx[i]);
  dv.setUint32(92, 3);
  return fullBox("mvhd", 0, 0, payload);
}

// ---- Video trak -----------------------------------------------------------

function buildVideoTrak(trackId: number, video: VideoTrackInfo): Uint8Array {
  return box("trak", buildTkhd(trackId, video.width, video.height, false), buildVideoMdia(video));
}

function buildTkhd(trackId: number, width: number, height: number, isAudio: boolean): Uint8Array {
  const payload = new Uint8Array(80);
  const dv = new DataView(payload.buffer);
  dv.setUint32(8, trackId);
  dv.setInt16(32, isAudio ? 0x0100 : 0);
  const mtx = [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000];
  for (let i = 0; i < 9; i++) dv.setUint32(36 + i * 4, mtx[i]);
  dv.setUint32(72, width << 16);
  dv.setUint32(76, height << 16);
  return fullBox("tkhd", 0, 3, payload);
}

function buildVideoMdia(video: VideoTrackInfo): Uint8Array {
  return box("mdia", buildMdhd(VIDEO_TIMESCALE), buildHdlr("vide", "VideoHandler"), buildVideoMinf(video));
}

function buildMdhd(timescale: number): Uint8Array {
  const payload = new Uint8Array(20);
  const dv = new DataView(payload.buffer);
  dv.setUint32(8, timescale);
  dv.setUint16(16, 0x55c4);
  return fullBox("mdhd", 0, 0, payload);
}

function buildHdlr(type: string, name: string): Uint8Array {
  const nameBytes = strBytes(name + "\0");
  return fullBox("hdlr", 0, 0, zeros(4), strBytes(type), zeros(12), nameBytes);
}

function buildVideoMinf(video: VideoTrackInfo): Uint8Array {
  return box("minf", buildVmhd(), buildDinf(), buildVideoStbl(video));
}

function buildVmhd(): Uint8Array {
  return fullBox("vmhd", 0, 1, zeros(8));
}

function buildSmhd(): Uint8Array {
  return fullBox("smhd", 0, 0, zeros(4));
}

function buildDinf(): Uint8Array {
  const url = fullBox("url ", 0, 1);
  const dref = fullBox("dref", 0, 0, u32(1), url);
  return box("dinf", dref);
}

function buildVideoStbl(video: VideoTrackInfo): Uint8Array {
  const sampleEntry = video.codec === 'avc' ? buildAvc1(video) : buildHev1(video);
  const stsd = fullBox("stsd", 0, 0, u32(1), sampleEntry);
  return box(
    "stbl", stsd,
    fullBox("stts", 0, 0, u32(0)),
    fullBox("stsc", 0, 0, u32(0)),
    fullBox("stsz", 0, 0, u32(0), u32(0)),
    fullBox("stco", 0, 0, u32(0)),
  );
}

function buildVideoSampleEntryPrefix(video: VideoTrackInfo): Uint8Array {
  const prefix = new Uint8Array(78);
  const dv = new DataView(prefix.buffer);
  dv.setUint16(6, 1);
  dv.setUint16(24, video.width);
  dv.setUint16(26, video.height);
  dv.setUint32(28, 0x00480000);
  dv.setUint32(32, 0x00480000);
  dv.setUint16(40, 1);
  dv.setUint16(74, 0x0018);
  dv.setInt16(76, -1);
  return prefix;
}

function buildAvc1(video: VideoTrackInfo): Uint8Array {
  const prefix = buildVideoSampleEntryPrefix(video);
  const avcC = box("avcC", video.codecPrivate);
  return box("avc1", prefix, avcC);
}

/**
 * HEVC sample entry. Despite the box being named `hvcC`, the *sample entry*
 * type we emit is `hev1`, not `hvc1`. The two differ in how strict the
 * parser is about parameter sets:
 *
 *   - `hvc1`: VPS/SPS/PPS MUST live ONLY in the `hvcC` config — any inline
 *     occurrence inside a NAL unit makes Chrome reject the buffer.
 *   - `hev1`: parameter sets MAY appear inline inside samples.
 *
 * Real-world x265 encodes (the common case here — YURASUKA, USBD, etc.)
 * routinely embed VPS/SPS/PPS inline in keyframes. Using `hev1` makes
 * those play without re-rewriting the bitstream. The `hvcC` config box
 * name is the same regardless of which sample-entry type we declare.
 *
 * The codec string in `buildHevcCodecString` is also `hev1.…` so the
 * advertised codec and the on-disk sample entry agree — Chrome's MSE
 * parser cross-checks them on the first appendBuffer.
 */
function buildHev1(video: VideoTrackInfo): Uint8Array {
  const prefix = buildVideoSampleEntryPrefix(video);
  const hvcC = box("hvcC", video.codecPrivate);
  return box("hev1", prefix, hvcC);
}

// ---- Audio trak -----------------------------------------------------------

function buildAudioTrak(trackId: number, audio: AudioTrackInfo): Uint8Array {
  return box("trak", buildTkhd(trackId, 0, 0, true), buildAudioMdia(audio));
}

function buildAudioMdia(audio: AudioTrackInfo): Uint8Array {
  return box("mdia", buildMdhd(audio.sampleRate), buildHdlr("soun", "SoundHandler"), buildAudioMinf(audio));
}

function buildAudioMinf(audio: AudioTrackInfo): Uint8Array {
  return box("minf", buildSmhd(), buildDinf(), buildAudioStbl(audio));
}

function buildAudioStbl(audio: AudioTrackInfo): Uint8Array {
  let sampleEntry: Uint8Array;
  if (audio.codec === 'aac') sampleEntry = buildMp4a(audio);
  else if (audio.codec === 'flac') sampleEntry = buildFlac(audio);
  else if (audio.codec === 'ac3') sampleEntry = buildAc3(audio);
  else sampleEntry = buildOpus(audio);

  const stsd = fullBox("stsd", 0, 0, u32(1), sampleEntry);
  return box(
    "stbl", stsd,
    fullBox("stts", 0, 0, u32(0)),
    fullBox("stsc", 0, 0, u32(0)),
    fullBox("stsz", 0, 0, u32(0), u32(0)),
    fullBox("stco", 0, 0, u32(0)),
  );
}

function buildAudioSampleEntryPrefix(
  audio: AudioTrackInfo,
  sampleSizeBits = 16,
): Uint8Array {
  const prefix = new Uint8Array(28);
  const dv = new DataView(prefix.buffer);
  dv.setUint16(6, 1);
  dv.setUint16(16, audio.channels);
  dv.setUint16(18, sampleSizeBits);
  // sample rate as 16.16 fixed point (safe for rates ≤ 65535)
  const sr = Math.min(audio.sampleRate, 65535);
  dv.setUint32(24, sr << 16);
  return prefix;
}

function buildMp4a(audio: AudioTrackInfo): Uint8Array {
  const prefix = buildAudioSampleEntryPrefix(audio);
  const esds = buildEsds(audio);
  return box("mp4a", prefix, esds);
}

function buildEsds(audio: AudioTrackInfo): Uint8Array {
  const asc = audio.codecPrivate;
  const decConfigDescr = concatBytes(
    new Uint8Array([
      0x04, 15 + asc.length, 0x40, 0x15,
      0x00, 0x00, 0x00,
      0x00, 0x01, 0xf4, 0x00,
      0x00, 0x01, 0xf4, 0x00,
      0x05, asc.length,
    ]),
    asc,
  );
  const slConfigDescr = new Uint8Array([0x06, 0x01, 0x02]);
  const esDescrPayload = concatBytes(u16(1), u8(0), decConfigDescr, slConfigDescr);
  const esDescr = concatBytes(new Uint8Array([0x03, esDescrPayload.length]), esDescrPayload);
  return fullBox("esds", 0, 0, esDescr);
}

function buildFlac(audio: AudioTrackInfo): Uint8Array {
  const prefix = buildAudioSampleEntryPrefix(
    audio,
    flacBitsPerSample(audio.codecPrivate),
  );
  const dfLa = buildDfla(audio.codecPrivate);
  return box("fLaC", prefix, dfLa);
}

/**
 * Bits-per-sample from a FLAC STREAMINFO block, so the AudioSampleEntry
 * advertises the true bit depth (Blu-ray FLAC is frequently 24-bit; a
 * hardcoded 16 makes the init segment inconsistent with the dfLa STREAMINFO,
 * which some browsers reject). Returns 16 when STREAMINFO can't be located.
 *
 * `codecPrivate` is the MKV A_FLAC CodecPrivate: optional "fLaC" magic, then
 * one or more metadata blocks. In the 34-byte STREAMINFO payload the packed
 * 5-bit bits_per_sample field straddles bytes 12-13.
 */
function flacBitsPerSample(codecPrivate: Uint8Array): number {
  let meta = codecPrivate;
  if (
    meta.length > 4 &&
    meta[0] === 0x66 && meta[1] === 0x4c &&
    meta[2] === 0x61 && meta[3] === 0x43
  ) {
    meta = meta.subarray(4);
  }
  let streamInfo: Uint8Array | null = null;
  if (meta.length === 34) {
    streamInfo = meta;
  } else {
    let offset = 0;
    while (offset + 4 <= meta.length) {
      const blockType = meta[offset] & 0x7f;
      const blockLen =
        (meta[offset + 1] << 16) | (meta[offset + 2] << 8) | meta[offset + 3];
      if (offset + 4 + blockLen > meta.length) break;
      if (blockType === 0) {
        streamInfo = meta.subarray(offset + 4, offset + 4 + blockLen);
        break;
      }
      offset += 4 + blockLen;
    }
  }
  if (!streamInfo || streamInfo.length < 18) return 16;
  return (((streamInfo[12] & 0x01) << 4) | (streamInfo[13] >> 4)) + 1;
}

/**
 * Build the dfLa (FLACSpecificBox) from MKV CodecPrivate.
 *
 * Per RFC 9639 / FLAC-in-ISOBMFF, the dfLa payload is a sequence of FLAC
 * metadata blocks (STREAMINFO mandatory, others optional) with the
 * last-block-flag set on the final block. The MKV A_FLAC CodecPrivate
 * field may carry the full FLAC stream header — STREAMINFO followed by
 * any number of VORBIS_COMMENT / SEEKTABLE / PADDING / etc. blocks —
 * optionally prefixed by the four-byte "fLaC" magic.
 *
 * An earlier implementation simply set the last-block flag on the first
 * block and shipped the rest verbatim. Some FLAC pipelines accept that;
 * Chrome's decoder rejects the audio packets that follow because the
 * remaining metadata leaks "noise" into the codec state and the
 * subsequent frames look misaligned. We sidestep the question by
 * walking the metadata stream and emitting **only STREAMINFO** inside
 * dfLa — the smallest possible spec-compliant payload, identical for
 * every FLAC file regardless of how creative the muxer was with extra
 * metadata.
 */
function buildDfla(codecPrivate: Uint8Array): Uint8Array {
  let metadata = codecPrivate;
  // Skip "fLaC" marker if present
  if (
    metadata.length > 4 &&
    metadata[0] === 0x66 && metadata[1] === 0x4c &&
    metadata[2] === 0x61 && metadata[3] === 0x43
  ) {
    metadata = metadata.slice(4);
  }

  // Case A: CodecPrivate is just the raw 34-byte STREAMINFO content
  // (no metadata-block header). Wrap it with a fresh last-block header.
  if (metadata.length === 34) {
    const out = new Uint8Array(38);
    out[0] = 0x80;
    out[1] = 0x00;
    out[2] = 0x00;
    out[3] = 34;
    out.set(metadata, 4);
    return fullBox("dfLa", 0, 0, out);
  }

  // Case B: full metadata-block stream. Walk it, find STREAMINFO, emit
  // ONLY that block marked as last. Everything else (VORBIS_COMMENT,
  // SEEKTABLE, PADDING, application blocks, ...) is dropped.
  let offset = 0;
  while (offset + 4 <= metadata.length) {
    const blockType = metadata[offset] & 0x7f;
    const blockLen =
      (metadata[offset + 1] << 16) |
      (metadata[offset + 2] << 8) |
      metadata[offset + 3];
    if (offset + 4 + blockLen > metadata.length) break; // truncated
    if (blockType === 0) {
      const out = new Uint8Array(4 + blockLen);
      out[0] = 0x80;
      out[1] = (blockLen >> 16) & 0xff;
      out[2] = (blockLen >> 8) & 0xff;
      out[3] = blockLen & 0xff;
      out.set(metadata.subarray(offset + 4, offset + 4 + blockLen), 4);
      return fullBox("dfLa", 0, 0, out);
    }
    offset += 4 + blockLen;
  }

  // Couldn't find a STREAMINFO block (shouldn't happen for a well-formed
  // FLAC track). Fall back to the raw metadata with the last-block bit
  // set on whatever comes first — best-effort, may still play.
  if (metadata.length > 0 && (metadata[0] & 0x80) === 0) {
    metadata = metadata.slice();
    metadata[0] |= 0x80;
  }
  return fullBox("dfLa", 0, 0, metadata);
}

function buildOpus(audio: AudioTrackInfo): Uint8Array {
  const prefix = buildAudioSampleEntryPrefix(audio);
  const dOps = buildDops(audio);
  return box("Opus", prefix, dOps);
}

function buildDops(audio: AudioTrackInfo): Uint8Array {
  return box("dOps", buildDopsPayload(audio));
}

function buildDopsPayload(audio: AudioTrackInfo): Uint8Array {
  // MKV A_OPUS CodecPrivate is the Ogg OpusHead packet. OpusHead stores
  // multi-byte integers little-endian, but ISO BMFF boxes store them
  // big-endian. Chrome accepts `audio/mp4; codecs="opus"` during MIME probe
  // and then rejects the init segment if dOps is copied byte-for-byte.
  const cp = audio.codecPrivate;
  const hasMagic =
    cp.length >= 8 &&
    cp[0] === 0x4f && cp[1] === 0x70 && cp[2] === 0x75 && cp[3] === 0x73 &&
    cp[4] === 0x48 && cp[5] === 0x65 && cp[6] === 0x61 && cp[7] === 0x64;
  const body = hasMagic ? cp.subarray(8) : cp;
  if (body.length < 11) {
    const fallback = new Uint8Array(11);
    fallback[0] = 1;
    fallback[1] = Math.max(1, Math.min(audio.channels || 2, 255));
    new DataView(fallback.buffer).setUint32(4, audio.sampleRate || 48000);
    return fallback;
  }

  const inView = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const mappingFamily = body[10];
  const tail =
    mappingFamily !== 0 && body.length > 11
      ? body.subarray(11)
      : new Uint8Array(0);
  const out = new Uint8Array(11 + tail.length);
  const outView = new DataView(out.buffer);
  out[0] = body[0]; // version
  out[1] = body[1] || Math.max(1, Math.min(audio.channels || 2, 255));
  outView.setUint16(2, inView.getUint16(2, true), false); // preSkip
  outView.setUint32(4, inView.getUint32(4, true), false); // inputSampleRate
  outView.setInt16(8, inView.getInt16(8, true), false);   // outputGain
  out[10] = mappingFamily;
  out.set(tail, 11);
  return out;
}

// ---- AC-3 -----------------------------------------------------------------

/**
 * Build an `ac-3` sample entry for the audio stsd. Same shape as `mp4a`
 * (the standard 28-byte audio prefix) with a `dac3` config box appended in
 * place of `esds`. AC-3 bitstreams pass through unmodified — each MKV
 * SimpleBlock already contains one AC-3 sync frame, which is exactly what
 * MP4 sample boundaries call for.
 */
function buildAc3(audio: AudioTrackInfo): Uint8Array {
  const prefix = buildAudioSampleEntryPrefix(audio);
  const dac3 = buildDac3(audio);
  return box("ac-3", prefix, dac3);
}

/**
 * Build the `dac3` (AC3SpecificBox) per ETSI TS 102 366 Annex F.
 *
 * Field layout (3 bytes, MSB-first across the row):
 *
 *   fscod          2 bits   sample-rate code: 0=48k 1=44.1k 2=32k 3=reserved
 *   bsid           5 bits   bitstream id; 8 = standard AC-3
 *   bsmod          3 bits   bitstream mode; 0 = complete main
 *   acmod          3 bits   audio coding mode (channel layout, see below)
 *   lfeon          1 bit    low-frequency-effects channel present
 *   bit_rate_code  5 bits   nominal bit rate; 23 = 640 kbps (max)
 *   reserved       5 bits   zero
 *
 * Channel mapping (acmod) is derived from the muxer's `Channels` count, with
 * LFE inferred for 6-channel (5.1) layouts. This matches ~99 % of fansub /
 * Blu-ray AC-3 tracks in the wild; exotic layouts (7.1 or asymmetric) will
 * still produce a valid box but acmod may not match the actual stream — the
 * AC-3 decoder picks up the truth from each frame's sync header anyway, so
 * the dac3 box is mostly advisory for the container.
 *
 * When the demuxer has already seen an AC-3 sync frame, those header fields
 * are used exactly. Otherwise we fall back to 640 kbps (`bit_rate_code = 18`),
 * the largest valid AC-3 bitrate code.
 */
function buildDac3(audio: AudioTrackInfo): Uint8Array {
  const fields = audio.ac3 ?? fallbackAc3Fields(audio);
  const fscod = clampBits(fields.fscod, 2);
  const bsid = clampBits(fields.bsid, 5);
  const bsmod = clampBits(fields.bsmod, 3);
  const acmod = clampBits(fields.acmod, 3);
  const lfeon = clampBits(fields.lfeon, 1);
  const bitRateCode = clampBits(fields.bitRateCode, 5);

  const payload = new Uint8Array(3);
  payload[0] = (fscod << 6) | (bsid << 1) | ((bsmod >> 2) & 0x01);
  payload[1] =
    ((bsmod & 0x03) << 6) |
    (acmod << 3) |
    (lfeon << 2) |
    ((bitRateCode >> 3) & 0x03);
  payload[2] = (bitRateCode & 0x07) << 5;
  return box("dac3", payload);
}

function fallbackAc3Fields(audio: AudioTrackInfo): Ac3SpecificBoxFields {
  const { acmod, lfeon } = ac3ChannelLayoutFor(audio.channels);
  return {
    fscod: ac3FscodFor(audio.sampleRate),
    bsid: 8,
    bsmod: 0,
    acmod,
    lfeon,
    bitRateCode: 18,
  };
}

function clampBits(value: number, bits: number): number {
  const max = (1 << bits) - 1;
  return Math.max(0, Math.min(max, value | 0));
}

function ac3FscodFor(sampleRate: number): number {
  if (sampleRate === 48000) return 0;
  if (sampleRate === 44100) return 1;
  if (sampleRate === 32000) return 2;
  // The decoder will reject `3` (reserved), so fall back to 48 kHz — the
  // overwhelmingly common case for AC-3 dubs. Mis-tagging here is benign:
  // each AC-3 sync frame carries its own fscod that the decoder honours.
  return 0;
}

function ac3ChannelLayoutFor(
  channels: number,
): { acmod: number; lfeon: number } {
  // ATSC A/52 acmod table (channels here is total INCLUDING LFE):
  //   acmod=1 → 1/0 mono
  //   acmod=2 → 2/0 stereo
  //   acmod=3 → 3/0 L C R
  //   acmod=4 → 2/1 L R S
  //   acmod=5 → 3/1 L C R S
  //   acmod=6 → 2/2 L R SL SR
  //   acmod=7 → 3/2 L C R SL SR
  switch (channels) {
    case 1:
      return { acmod: 1, lfeon: 0 };
    case 2:
      return { acmod: 2, lfeon: 0 };
    case 3:
      return { acmod: 3, lfeon: 0 };
    case 4:
      return { acmod: 6, lfeon: 0 };
    case 5:
      return { acmod: 7, lfeon: 0 };
    case 6:
      return { acmod: 7, lfeon: 1 }; // 5.1
    default:
      return { acmod: 2, lfeon: 0 };
  }
}

// ---- mvex -----------------------------------------------------------------

function buildMvex(trackCount: number): Uint8Array {
  const trexes: Uint8Array[] = [];
  for (let i = 1; i <= trackCount; i++) {
    const payload = new Uint8Array(20);
    const dv = new DataView(payload.buffer);
    dv.setUint32(0, i);
    dv.setUint32(4, 1);
    trexes.push(fullBox("trex", 0, 0, payload));
  }
  return box("mvex", ...trexes);
}

// ---------------------------------------------------------------------------
// Media segments
// ---------------------------------------------------------------------------

const KEYFRAME_FLAGS = 0x02000000;
const NON_KEYFRAME_FLAGS = 0x01010000;

/**
 * Multiplexed media segment — kept for backwards compatibility with code
 * that still drives a single SourceBuffer. New code should call
 * `generateVideoMediaSegment` / `generateAudioMediaSegment` and feed two
 * SourceBuffers; that's what enables seamless audio swapping in-flight.
 */
export function generateMediaSegment(
  samples: DemuxedSample[],
  sequenceNumber: number,
  video: VideoTrackInfo,
  audio?: AudioTrackInfo,
): Uint8Array {
  const videoSamples = samples.filter((s) => s.isVideo);
  const audioSamples = samples.filter((s) => !s.isVideo);

  fillDurations(videoSamples, video.defaultDurationNs);
  if (audio) fillDurations(audioSamples, audio.defaultDurationNs);

  const trafs: TrafInput[] = [];
  if (videoSamples.length > 0) {
    trafs.push(makeVideoTrafInput(videoSamples, 1));
  }
  if (audio && audioSamples.length > 0) {
    trafs.push(makeAudioTrafInput(audioSamples, 2, audio));
  }
  return assembleMediaSegment(sequenceNumber, trafs);
}

/**
 * Video-only fragment: one moof + one mdat carrying video samples for the
 * dedicated video SourceBuffer. trackId is 1 because the split init segment
 * defines a single trak.
 */
export function generateVideoMediaSegment(
  samples: DemuxedSample[],
  sequenceNumber: number,
  video: VideoTrackInfo,
  baseDecodeTimeMs?: number,
): Uint8Array {
  const videoSamples = samples.filter((s) => s.isVideo);
  if (videoSamples.length === 0) return new Uint8Array(0);
  fillDurations(videoSamples, video.defaultDurationNs);
  return assembleMediaSegment(sequenceNumber, [
    makeVideoTrafInput(videoSamples, 1, baseDecodeTimeMs),
  ]);
}

/**
 * Audio-only fragment for the dedicated audio SourceBuffer. Called both
 * from the main streaming loop (forward emission for the currently-selected
 * dub) and from the side catch-up fetch that backfills audio after a swap.
 */
export function generateAudioMediaSegment(
  samples: DemuxedSample[],
  sequenceNumber: number,
  audio: AudioTrackInfo,
): Uint8Array {
  const audioSamples = samples.filter((s) => !s.isVideo);
  if (audioSamples.length === 0) return new Uint8Array(0);
  fillDurations(audioSamples, audio.defaultDurationNs);
  return assembleMediaSegment(sequenceNumber, [
    makeAudioTrafInput(audioSamples, 1, audio),
  ]);
}

interface TrafInput {
  trackId: number;
  baseDecodeTime: number;
  /** Per-sample triples (duration/size/flags) — does NOT include sample_count;
   *  that gets written by `buildTrun` in the spec-correct slot. */
  perSampleData: Uint8Array;
  sampleCount: number;
  sampleData: Uint8Array[];
  dataSize: number;
  hasCompositionOffsets?: boolean;
}

function makeVideoTrafInput(
  samples: DemuxedSample[],
  trackId: number,
  baseDecodeTimeMs?: number,
): TrafInput {
  const ptsTicks = samples.map((s) =>
    Math.round((s.pts / 1000) * VIDEO_TIMESCALE),
  );
  const baseDts = baseDecodeTimeMs == null
    ? Math.min(...ptsTicks)
    : Math.round((baseDecodeTimeMs / 1000) * VIDEO_TIMESCALE);
  const compositionOffsets = new Int32Array(samples.length);
  let sampleDts = baseDts;
  for (let i = 0; i < samples.length; i++) {
    compositionOffsets[i] = ptsTicks[i] - sampleDts;
    sampleDts += Math.round((samples[i].duration / 1000) * VIDEO_TIMESCALE) || 1;
  }
  const perSampleData = buildPerSampleTriples(
    samples,
    VIDEO_TIMESCALE,
    compositionOffsets,
  );
  let dataSize = 0;
  const sampleData: Uint8Array[] = [];
  for (const s of samples) { sampleData.push(s.data); dataSize += s.data.length; }
  return {
    trackId,
    baseDecodeTime: baseDts,
    perSampleData,
    sampleCount: samples.length,
    sampleData,
    dataSize,
    hasCompositionOffsets: true,
  };
}

function makeAudioTrafInput(
  samples: DemuxedSample[],
  trackId: number,
  audio: AudioTrackInfo,
): TrafInput {
  const baseDts = Math.round((samples[0].pts / 1000) * audio.sampleRate);
  const perSampleData = buildPerSampleTriples(samples, audio.sampleRate);
  let dataSize = 0;
  const sampleData: Uint8Array[] = [];
  for (const s of samples) { sampleData.push(s.data); dataSize += s.data.length; }
  return {
    trackId,
    baseDecodeTime: baseDts,
    perSampleData,
    sampleCount: samples.length,
    sampleData,
    dataSize,
  };
}

function assembleMediaSegment(seq: number, trafs: TrafInput[]): Uint8Array {
  const mfhd = buildMfhd(seq);

  // Two passes: first measure traf sizes (data_offset depends on moof size)
  const trafSizes: number[] = [];
  for (const ti of trafs) {
    const tfhd = buildTfhd(ti.trackId);
    const tfdt = buildTfdt(ti.baseDecodeTime);
    const trun = buildTrun(
      ti.perSampleData,
      ti.sampleCount,
      0,
      ti.hasCompositionOffsets === true,
    );
    trafSizes.push(box("traf", tfhd, tfdt, trun).length);
  }
  const moofPayloadSize = mfhd.length + trafSizes.reduce((a, b) => a + b, 0);
  const moofSize = 8 + moofPayloadSize;

  const trafBoxes: Uint8Array[] = [];
  const mdatParts: Uint8Array[] = [];
  let dataOffsetAcc = moofSize + 8;
  for (const ti of trafs) {
    trafBoxes.push(
      box(
        "traf",
        buildTfhd(ti.trackId),
        buildTfdt(ti.baseDecodeTime),
        buildTrun(
          ti.perSampleData,
          ti.sampleCount,
          dataOffsetAcc,
          ti.hasCompositionOffsets === true,
        ),
      ),
    );
    dataOffsetAcc += ti.dataSize;
    for (const d of ti.sampleData) mdatParts.push(d);
  }

  const moof = box("moof", mfhd, ...trafBoxes);

  let mdatSize = 0;
  for (const p of mdatParts) mdatSize += p.length;
  const mdatHeader = new Uint8Array(8);
  const mdv = new DataView(mdatHeader.buffer);
  mdv.setUint32(0, 8 + mdatSize);
  mdatHeader[4] = 0x6d; mdatHeader[5] = 0x64; mdatHeader[6] = 0x61; mdatHeader[7] = 0x74;

  return concatBytes(moof, mdatHeader, ...mdatParts);
}

function buildMfhd(seq: number): Uint8Array { return fullBox("mfhd", 0, 0, u32(seq)); }

function buildTfhd(trackId: number): Uint8Array {
  return fullBox("tfhd", 0, 0x020000, u32(trackId));
}

function buildTfdt(baseDecodeTime: number): Uint8Array {
  if (baseDecodeTime <= 0xffffffff) return fullBox("tfdt", 0, 0, u32(baseDecodeTime));
  const payload = new Uint8Array(8);
  const dv = new DataView(payload.buffer);
  dv.setUint32(0, Math.floor(baseDecodeTime / 0x100000000));
  dv.setUint32(4, baseDecodeTime >>> 0);
  return fullBox("tfdt", 1, 0, payload);
}

/**
 * Build a TrackRunBox per ISO/IEC 14496-12 §8.8.8.
 *
 * Critical ordering: `sample_count` MUST be written before `data_offset`.
 * An earlier version of this code wrote `data_offset` first, which Chrome's
 * MSE parser interpreted as a sample_count in the thousands — every video
 * media fragment was rejected with "SourceBuffer error (stage=media)".
 * Audio fragments slipped through because their tiny size let Chrome's
 * fallback box-size derivation paper over the mis-order; video did not.
 */
function buildTrun(
  perSampleData: Uint8Array,
  sampleCount: number,
  dataOffset: number,
  hasCompositionOffsets = false,
): Uint8Array {
  return fullBox(
    "trun",
    hasCompositionOffsets ? 1 : 0,
    hasCompositionOffsets ? 0x000f01 : 0x000701,
    u32(sampleCount),
    u32(dataOffset),
    perSampleData,
  );
}

/** Per-sample duration/size/flags triples. `sample_count` is written by
 *  `buildTrun` in the spec-correct field; do not prepend it here. */
function buildPerSampleTriples(
  samples: DemuxedSample[],
  timescale: number,
  compositionOffsets?: Int32Array,
): Uint8Array {
  const fieldsPerSample = compositionOffsets ? 16 : 12;
  const buf = new Uint8Array(samples.length * fieldsPerSample);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const off = i * fieldsPerSample;
    dv.setUint32(off, Math.round((s.duration / 1000) * timescale) || 1);
    dv.setUint32(off + 4, s.data.length);
    dv.setUint32(off + 8, s.isKeyframe ? KEYFRAME_FLAGS : NON_KEYFRAME_FLAGS);
    if (compositionOffsets) {
      dv.setInt32(off + 12, compositionOffsets[i] ?? 0);
    }
  }
  return buf;
}

/**
 * Assign a duration to every sample that doesn't already have one.
 *
 * For HEVC/AVC with B-frames, samples arrive from the demuxer in **decode**
 * order. A neighbour's PTS may belong to the next decoded frame (P after I,
 * jumping ahead by the full GOP reorder delay before the B-frames fill in),
 * so PTS deltas overstate the I-frame's duration by 4-5x. With B-frame
 * video we MUST use `defaultDurationNs` from the MKV TrackEntry instead —
 * for CFR content (every BD encode) that's the exact frame interval.
 *
 * Audio samples are monotonic but defaultDurationNs is just as accurate
 * there, so prefer it uniformly. Falls back to PTS delta only when the
 * muxer didn't author a default duration.
 */
function fillDurations(samples: DemuxedSample[], defaultDurNs: number) {
  const defaultMs = defaultDurNs > 0 ? defaultDurNs / 1_000_000 : 0;
  const fallbackMs = samples[0]?.isVideo ? 33 : 23;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].duration > 0) continue;
    if (defaultMs > 0) {
      samples[i].duration = defaultMs;
      continue;
    }
    if (i < samples.length - 1) {
      const delta = samples[i + 1].pts - samples[i].pts;
      if (delta > 0) {
        samples[i].duration = delta;
        continue;
      }
    }
    samples[i].duration = fallbackMs;
  }
}
