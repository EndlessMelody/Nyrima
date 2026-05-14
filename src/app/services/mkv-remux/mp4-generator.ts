/**
 * Fragmented MP4 (ISO BMFF) box generator.
 *
 * Builds the binary structures needed to feed a MediaSource SourceBuffer:
 *   - Init segment: ftyp + moov (with avcC/hvcC for video, esds/dfLa for audio)
 *   - Media segments: moof + mdat (one per MKV Cluster)
 *
 * Supported codecs:
 *   Video: H.264 (AVC), H.265 (HEVC)
 *   Audio: AAC, FLAC, Opus
 */

import type { VideoTrackInfo, AudioTrackInfo, DemuxedSample } from "./types";

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

export function generateInitSegment(
  video: VideoTrackInfo,
  audio?: AudioTrackInfo,
): { data: Uint8Array; codecString: string } {
  const ftyp = buildFtyp();
  const moov = buildMoov(video, audio);
  const codecString = buildCodecString(video, audio);
  return { data: concatBytes(ftyp, moov), codecString };
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
  let codec: string;

  if (video.codec === 'avc') {
    const cp = video.codecPrivate;
    const profile = cp[1].toString(16).padStart(2, "0");
    const compat = cp[2].toString(16).padStart(2, "0");
    const level = cp[3].toString(16).padStart(2, "0");
    codec = `avc1.${profile}${compat}${level}`;
  } else {
    // HEVC — parse HEVCDecoderConfigurationRecord
    codec = buildHevcCodecString(video.codecPrivate);
  }

  if (audio) {
    if (audio.codec === 'aac') codec += ", mp4a.40.2";
    else if (audio.codec === 'flac') codec += ", flac";
    else if (audio.codec === 'opus') codec += ", opus";
  }
  return codec;
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

function buildMoov(video: VideoTrackInfo, audio?: AudioTrackInfo): Uint8Array {
  const parts: Uint8Array[] = [buildMvhd(), buildVideoTrak(video)];
  if (audio) parts.push(buildAudioTrak(audio));
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

function buildVideoTrak(video: VideoTrackInfo): Uint8Array {
  return box("trak", buildTkhd(1, video.width, video.height, false), buildVideoMdia(video));
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
  const sampleEntry = video.codec === 'avc' ? buildAvc1(video) : buildHvc1(video);
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

function buildHvc1(video: VideoTrackInfo): Uint8Array {
  const prefix = buildVideoSampleEntryPrefix(video);
  const hvcC = box("hvcC", video.codecPrivate);
  return box("hvc1", prefix, hvcC);
}

// ---- Audio trak -----------------------------------------------------------

function buildAudioTrak(audio: AudioTrackInfo): Uint8Array {
  return box("trak", buildTkhd(2, 0, 0, true), buildAudioMdia(audio));
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

function buildAudioSampleEntryPrefix(audio: AudioTrackInfo): Uint8Array {
  const prefix = new Uint8Array(28);
  const dv = new DataView(prefix.buffer);
  dv.setUint16(6, 1);
  dv.setUint16(16, audio.channels);
  dv.setUint16(18, 16);
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
  const prefix = buildAudioSampleEntryPrefix(audio);
  const dfLa = buildDfla(audio.codecPrivate);
  return box("fLaC", prefix, dfLa);
}

/**
 * Build the dfLa (FLACSpecificBox) from MKV CodecPrivate.
 *
 * MKV A_FLAC CodecPrivate contains the FLAC metadata blocks
 * (STREAMINFO header + data, possibly preceded by "fLaC" marker).
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

  // If CodecPrivate is just the raw STREAMINFO (34 bytes) without the
  // 4-byte metadata block header, prepend the header.
  if (metadata.length === 34) {
    const hdr = new Uint8Array(4);
    hdr[0] = 0x80; // last-block-flag=1, block-type=0 (STREAMINFO)
    hdr[1] = 0x00;
    hdr[2] = 0x00;
    hdr[3] = 34;
    metadata = concatBytes(hdr, metadata);
  } else if (metadata.length > 0 && (metadata[0] & 0x7f) === 0) {
    // Has metadata block header; ensure last-block-flag is set on first block
    metadata = metadata.slice(); // copy to avoid mutating original
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
  // MKV A_OPUS CodecPrivate is the OpusHead packet.
  // dOps box contains the OpusHead data starting from byte 8 (skip "OpusHead" magic).
  let opusHead = audio.codecPrivate;
  if (opusHead.length > 8) {
    const magic = String.fromCharCode(...opusHead.slice(0, 8));
    if (magic === "OpusHead") opusHead = opusHead.slice(8);
  }
  return box("dOps", opusHead);
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

  const mfhd = buildMfhd(sequenceNumber);

  interface TrafInfo {
    trackId: number;
    timescale: number;
    baseDecodeTime: number;
    trunPayload: Uint8Array;
    dataSize: number;
  }
  const trafInfos: TrafInfo[] = [];
  const mdatParts: Uint8Array[] = [];

  if (videoSamples.length > 0) {
    const baseMs = videoSamples[0].pts;
    const baseDts = Math.round((baseMs / 1000) * VIDEO_TIMESCALE);
    const trunPayload = buildTrunPayload(videoSamples, VIDEO_TIMESCALE);
    let dataSize = 0;
    for (const s of videoSamples) { mdatParts.push(s.data); dataSize += s.data.length; }
    trafInfos.push({ trackId: 1, timescale: VIDEO_TIMESCALE, baseDecodeTime: baseDts, trunPayload, dataSize });
  }

  if (audio && audioSamples.length > 0) {
    const baseMs = audioSamples[0].pts;
    const baseDts = Math.round((baseMs / 1000) * audio.sampleRate);
    const trunPayload = buildTrunPayload(audioSamples, audio.sampleRate);
    let dataSize = 0;
    for (const s of audioSamples) { mdatParts.push(s.data); dataSize += s.data.length; }
    trafInfos.push({ trackId: 2, timescale: audio.sampleRate, baseDecodeTime: baseDts, trunPayload, dataSize });
  }

  // Measure traf sizes to compute data_offset
  const trafSizes: number[] = [];
  for (const ti of trafInfos) {
    const tfhd = buildTfhd(ti.trackId);
    const tfdt = buildTfdt(ti.baseDecodeTime);
    const trun = buildTrun(ti.trunPayload, 0);
    trafSizes.push(box("traf", tfhd, tfdt, trun).length);
  }

  const moofPayloadSize = mfhd.length + trafSizes.reduce((a, b) => a + b, 0);
  const moofSize = 8 + moofPayloadSize;

  const trafs: Uint8Array[] = [];
  let dataOffsetAcc = moofSize + 8;
  for (const ti of trafInfos) {
    trafs.push(box("traf", buildTfhd(ti.trackId), buildTfdt(ti.baseDecodeTime), buildTrun(ti.trunPayload, dataOffsetAcc)));
    dataOffsetAcc += ti.dataSize;
  }

  const moof = box("moof", mfhd, ...trafs);

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

function buildTrun(trunPayload: Uint8Array, dataOffset: number): Uint8Array {
  return fullBox("trun", 0, 0x000701, u32(dataOffset), trunPayload);
}

function buildTrunPayload(samples: DemuxedSample[], timescale: number): Uint8Array {
  const buf = new Uint8Array(4 + samples.length * 12);
  const dv = new DataView(buf.buffer);
  dv.setUint32(0, samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = samples[i];
    const off = 4 + i * 12;
    dv.setUint32(off, Math.round((s.duration / 1000) * timescale) || 1);
    dv.setUint32(off + 4, s.data.length);
    dv.setUint32(off + 8, s.isKeyframe ? KEYFRAME_FLAGS : NON_KEYFRAME_FLAGS);
  }
  return buf;
}

function fillDurations(samples: DemuxedSample[], defaultDurNs: number) {
  const defaultMs = defaultDurNs > 0 ? defaultDurNs / 1_000_000 : 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].duration > 0) continue;
    if (i < samples.length - 1) {
      samples[i].duration = samples[i + 1].pts - samples[i].pts;
    } else if (defaultMs > 0) {
      samples[i].duration = defaultMs;
    } else {
      samples[i].duration = samples[i].isVideo ? 33 : 23;
    }
    if (samples[i].duration <= 0) samples[i].duration = 1;
  }
}
