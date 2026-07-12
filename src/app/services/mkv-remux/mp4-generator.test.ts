/**
 * Init-segment generation tests for the audio path.
 *
 * The video side is exercised by the integration of MSE controller + real
 * MKVs; these tests pin down the per-codec audio sample-entry boxes so
 * regressions in bit packing don't slip into a release. AC-3 packing in
 * particular is dense (24 bits in 3 bytes spread across 7 fields), and
 * the spec leaves no margin for off-by-one.
 */

import { describe, expect, it } from "vitest";
import {
  generateAudioInitSegment,
  generateInitSegment,
  generateVideoMediaSegment,
  generateVideoInitSegment,
} from "./mp4-generator";
import type {
  Ac3SpecificBoxFields,
  AudioTrackInfo,
  DemuxedSample,
  VideoTrackInfo,
} from "./types";

/** Minimal H.264 AVCDecoderConfigurationRecord: profile=Baseline (0x42),
 *  compatibility=0, level=3.0 (0x1E), length-size-minus-one=3, zero SPS/PPS. */
const AVCC_BASELINE_30 = new Uint8Array([
  0x01, 0x42, 0x00, 0x1e, 0xff, 0xe1, 0x00, 0x00, 0x01, 0x00, 0x00,
]);

const VIDEO_AVC: VideoTrackInfo = {
  trackNumber: 1,
  codec: "avc",
  codecPrivate: AVCC_BASELINE_30,
  width: 1920,
  height: 1080,
  defaultDurationNs: 41_708_333,
};

function makeAc3(
  sampleRate: number,
  channels: number,
  ac3?: Ac3SpecificBoxFields,
): AudioTrackInfo {
  return {
    trackNumber: 2,
    codec: "ac3",
    codecPrivate: new Uint8Array(0),
    sampleRate,
    channels,
    defaultDurationNs: 32_000_000,
    language: "jpn",
    name: "Japanese 5.1",
    ac3,
  };
}

function makeOpus(codecPrivate: Uint8Array): AudioTrackInfo {
  return {
    trackNumber: 2,
    codec: "opus",
    codecPrivate,
    sampleRate: 48000,
    channels: 2,
    defaultDurationNs: 20_000_000,
    language: "jpn",
    name: "Japanese 2.0",
  };
}

/** Locate the 4-byte ASCII tag inside `buf` and return the offset of its
 *  size field (i.e. tag start minus 4). Throws when the tag isn't present. */
function findBox(buf: Uint8Array, tag: string): number {
  for (let i = 0; i < buf.length - 4; i++) {
    if (
      buf[i] === tag.charCodeAt(0) &&
      buf[i + 1] === tag.charCodeAt(1) &&
      buf[i + 2] === tag.charCodeAt(2) &&
      buf[i + 3] === tag.charCodeAt(3)
    ) {
      return i - 4;
    }
  }
  throw new Error(`box "${tag}" not found in init segment`);
}

function readTfdtBaseDecodeTime(buf: Uint8Array): number {
  const tfdtStart = findBox(buf, "tfdt");
  const version = buf[tfdtStart + 8];
  const dv = new DataView(buf.buffer, buf.byteOffset);
  if (version === 0) return dv.getUint32(tfdtStart + 12, false);
  const high = dv.getUint32(tfdtStart + 12, false);
  const low = dv.getUint32(tfdtStart + 16, false);
  return high * 0x100000000 + low;
}

describe("generateAudioInitSegment — Opus audio", () => {
  const opusHead = new Uint8Array([
    0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64, // "OpusHead"
    0x01, // version
    0x02, // channels
    0x38, 0x01, // preSkip = 312, little-endian in OpusHead
    0x80, 0xbb, 0x00, 0x00, // input sample rate = 48000, little-endian
    0x00, 0x00, // output gain
    0x00, // channel mapping family
  ]);

  it("emits an Opus sample entry containing dOps", () => {
    const { data } = generateAudioInitSegment(makeOpus(opusHead));
    expect(() => findBox(data, "Opus")).not.toThrow();
    expect(() => findBox(data, "dOps")).not.toThrow();
  });

  it("converts OpusHead little-endian fields to dOps big-endian fields", () => {
    const { data } = generateAudioInitSegment(makeOpus(opusHead));
    const dopsStart = findBox(data, "dOps");
    const payload = data.subarray(dopsStart + 8, dopsStart + 19);

    expect(Array.from(payload)).toEqual([
      0x01, // version
      0x02, // channels
      0x01, 0x38, // preSkip = 312, big-endian in dOps
      0x00, 0x00, 0xbb, 0x80, // input sample rate = 48000, big-endian
      0x00, 0x00, // output gain
      0x00, // mapping family
    ]);
  });

  it("also accepts CodecPrivate with the OpusHead magic already stripped", () => {
    const { data } = generateAudioInitSegment(makeOpus(opusHead.subarray(8)));
    const dopsStart = findBox(data, "dOps");
    const payload = data.subarray(dopsStart + 8, dopsStart + 19);
    expect(Array.from(payload.slice(2, 8))).toEqual([
      0x01, 0x38,
      0x00, 0x00, 0xbb, 0x80,
    ]);
  });
});

describe("generateInitSegment — AC-3 audio", () => {
  it("advertises ac-3 in the codec string", () => {
    const { codecString } = generateInitSegment(VIDEO_AVC, makeAc3(48000, 6));
    expect(codecString).toContain("ac-3");
  });

  it("emits an 'ac-3' sample entry containing a 'dac3' config box", () => {
    const { data } = generateInitSegment(VIDEO_AVC, makeAc3(48000, 6));
    // Both magic strings must appear in the init segment for Chrome to
    // recognise the audio track as AC-3.
    expect(() => findBox(data, "ac-3")).not.toThrow();
    expect(() => findBox(data, "dac3")).not.toThrow();
  });

  it("packs dac3 fields for 48 kHz 5.1 (acmod=7, lfeon=1)", () => {
    const { data } = generateInitSegment(VIDEO_AVC, makeAc3(48000, 6));
    const dac3Start = findBox(data, "dac3");
    // dac3 box layout: [size:4][type:4][payload:3]
    const payload = data.subarray(dac3Start + 8, dac3Start + 11);

    // Re-derive the expected packing here so a future change to the bit
    // layout fails noisily instead of silently producing bad init segs.
    //
    //   fscod=0 (48k), bsid=8, bsmod=0, acmod=7, lfeon=1, bit_rate_code=18
    //
    // byte 0 = fscod[2] bsid[5] bsmod[1-bit, top]
    //        = (0<<6) | (8<<1) | 0
    //        = 0x10
    // byte 1 = bsmod[2-bits, bottom] acmod[3] lfeon[1] bit_rate_code[2-top]
    //        = (0<<6) | (7<<3) | (1<<2) | ((18>>3)&3)
    //        = 0x00 | 0x38 | 0x04 | 0x02 = 0x3E
    // byte 2 = bit_rate_code[3-bottom] reserved[5]
    //        = ((18&7)<<5) = 0x40
    expect(Array.from(payload)).toEqual([0x10, 0x3e, 0x40]);
  });

  it("packs dac3 fields for 48 kHz stereo (acmod=2, lfeon=0)", () => {
    const { data } = generateInitSegment(VIDEO_AVC, makeAc3(48000, 2));
    const dac3Start = findBox(data, "dac3");
    const payload = data.subarray(dac3Start + 8, dac3Start + 11);
    // fscod=0, bsid=8, bsmod=0, acmod=2, lfeon=0, bit_rate_code=18
    // byte 0 = (0<<6)|(8<<1)|0 = 0x10
    // byte 1 = (0<<6)|(2<<3)|(0<<2)|((18>>3)&3) = 0x10 | 0x02 = 0x12
    // byte 2 = ((18&7)<<5) = 0x40
    expect(Array.from(payload)).toEqual([0x10, 0x12, 0x40]);
  });

  it("prefers AC-3 fields parsed from the first sync frame", () => {
    const { data } = generateInitSegment(
      VIDEO_AVC,
      makeAc3(48000, 2, {
        fscod: 0,
        bsid: 8,
        bsmod: 0,
        acmod: 2,
        lfeon: 0,
        bitRateCode: 10,
      }),
    );
    const dac3Start = findBox(data, "dac3");
    const payload = data.subarray(dac3Start + 8, dac3Start + 11);

    expect(Array.from(payload)).toEqual([0x10, 0x11, 0x40]);
  });

  it("maps 44.1 kHz to fscod=1", () => {
    const { data } = generateInitSegment(VIDEO_AVC, makeAc3(44100, 2));
    const dac3Start = findBox(data, "dac3");
    // byte 0 high two bits = fscod
    expect((data[dac3Start + 8] >> 6) & 0x03).toBe(1);
  });

  it("maps 32 kHz to fscod=2", () => {
    const { data } = generateInitSegment(VIDEO_AVC, makeAc3(32000, 2));
    const dac3Start = findBox(data, "dac3");
    expect((data[dac3Start + 8] >> 6) & 0x03).toBe(2);
  });
});

describe("generateVideoMediaSegment — trun byte layout", () => {
  // Minimal H.264 sample with a 4-byte length prefix + tiny NAL payload.
  // Chrome doesn't parse the NAL contents at the trun layout check, so any
  // length-prefixed bytes pass the framer check.
  const makeFrame = (pts: number, isKeyframe: boolean): DemuxedSample => ({
    trackNumber: 1,
    isVideo: true,
    pts,
    duration: 0, // let fillDurations fill it from defaultDurationNs
    data: new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01]),
    isKeyframe,
  });

  it("writes sample_count BEFORE data_offset (per ISO/IEC 14496-12 §8.8.8)", () => {
    // Three samples mimicking an I-P-B opening in decode order.
    const samples: DemuxedSample[] = [
      makeFrame(0, true),
      makeFrame(166, false),
      makeFrame(42, false),
    ];
    const seg = generateVideoMediaSegment(samples, 1, VIDEO_AVC);

    // Find the trun box. Layout we expect after the 8-byte box header:
    //   bytes 0-3  : version(1) + flags(3) = 0x01 0x00 0x0f 0x01
    //   bytes 4-7  : sample_count = 3
    //   bytes 8-11 : data_offset (moofSize + 8 — positive)
    //   bytes 12+  : per-sample duration/size/flags/ctts entries
    const trunStart = findBox(seg, "trun");
    const fullboxFlags =
      (seg[trunStart + 8] << 24) |
      (seg[trunStart + 9] << 16) |
      (seg[trunStart + 10] << 8) |
      seg[trunStart + 11];
    expect(fullboxFlags >>> 24).toBe(1);
    expect(fullboxFlags & 0xffffff).toBe(0x000f01);

    const declaredSampleCount =
      (seg[trunStart + 12] << 24) |
      (seg[trunStart + 13] << 16) |
      (seg[trunStart + 14] << 8) |
      seg[trunStart + 15];
    expect(declaredSampleCount).toBe(3);

    // data_offset is the 4 bytes RIGHT AFTER sample_count and should be
    // positive (it points into the mdat that follows the moof).
    const declaredDataOffset =
      (seg[trunStart + 16] << 24) |
      (seg[trunStart + 17] << 16) |
      (seg[trunStart + 18] << 8) |
      seg[trunStart + 19];
    expect(declaredDataOffset).toBeGreaterThan(0);
    // If we accidentally swap them again, declaredDataOffset would equal
    // 3 and declaredSampleCount would be a 3-digit-plus number — pin the
    // ordering with this final cross-check.
    expect(declaredDataOffset).not.toBe(3);
  });

  it("emits per-sample duration from defaultDurationNs (not PTS deltas)", () => {
    // PTS jumps from 0 → 166 → 42 (decode-order I→P→B); PTS deltas would
    // give 166ms / -124ms / fallback durations, all wrong. With the fix
    // we expect ~41.7ms each from the 41,708,333 ns TrackEntry default.
    const samples: DemuxedSample[] = [
      makeFrame(0, true),
      makeFrame(166, false),
      makeFrame(42, false),
    ];
    const seg = generateVideoMediaSegment(samples, 1, VIDEO_AVC);
    const trunStart = findBox(seg, "trun");
    // First per-sample triple starts at trunStart + 8 (box hdr) + 4 (vf) +
    // 4 (sample_count) + 4 (data_offset) = 20. Each triple is 12 bytes.
    const firstSampleDuration =
      (seg[trunStart + 20] << 24) |
      (seg[trunStart + 21] << 16) |
      (seg[trunStart + 22] << 8) |
      seg[trunStart + 23];
    // VIDEO_TIMESCALE = 90000 ticks/sec. 41.7ms * 90 = 3753 ticks.
    expect(firstSampleDuration).toBeGreaterThanOrEqual(3700);
    expect(firstSampleDuration).toBeLessThanOrEqual(3800);
  });

  it("emits signed composition offsets for decode-order B-frames", () => {
    const samples: DemuxedSample[] = [
      makeFrame(0, true),
      makeFrame(166, false),
      makeFrame(42, false),
    ];
    const seg = generateVideoMediaSegment(samples, 1, VIDEO_AVC);
    const trunStart = findBox(seg, "trun");
    const dv = new DataView(seg.buffer, seg.byteOffset);

    // First per-sample record starts at trunStart + 20. Each video record is
    // now 16 bytes: duration, size, flags, signed composition_time_offset.
    const firstCto = dv.getInt32(trunStart + 20 + 12, false);
    const secondCto = dv.getInt32(trunStart + 36 + 12, false);
    const thirdCto = dv.getInt32(trunStart + 52 + 12, false);

    expect(firstCto).toBe(0);
    expect(secondCto).toBeGreaterThan(0);
    // The third sample is a B-frame whose display time is before its decode
    // slot, so trun version 1 must carry a negative signed offset.
    expect(thirdCto).toBeLessThan(0);
  });

  it("honors an explicit continuous video decode clock", () => {
    const firstRun: DemuxedSample[] = [
      makeFrame(0, true),
      makeFrame(166, false),
      makeFrame(42, false),
    ];
    const secondRun: DemuxedSample[] = [
      makeFrame(1000, true),
      makeFrame(1166, false),
      makeFrame(1042, false),
    ];
    const firstSeg = generateVideoMediaSegment(firstRun, 1, VIDEO_AVC, 0);
    const nextDecodeMs = (VIDEO_AVC.defaultDurationNs / 1_000_000) * 3;
    const secondSeg = generateVideoMediaSegment(
      secondRun,
      2,
      VIDEO_AVC,
      nextDecodeMs,
    );

    expect(readTfdtBaseDecodeTime(firstSeg)).toBe(0);
    expect(readTfdtBaseDecodeTime(secondSeg)).toBe(
      Math.round((nextDecodeMs / 1000) * 90_000),
    );
    expect(readTfdtBaseDecodeTime(secondSeg)).not.toBe(90_000);
  });
});

describe("buildDfla — STREAMINFO extraction", () => {
  // Helper to construct a fake multi-block FLAC CodecPrivate.
  // We synthesise minimum-viable STREAMINFO + a fake VORBIS_COMMENT
  // tail and check that dfLa contains only STREAMINFO marked last.
  function makeMultiBlockCodecPrivate(): Uint8Array {
    const streaminfo = new Uint8Array(34); // contents don't matter for the test
    streaminfo[0] = 0x12; // just to make it non-zero
    const vorbisCommentLen = 40;
    const vorbisComment = new Uint8Array(vorbisCommentLen);
    vorbisComment[0] = 0x42;
    // Build: [hdr1: type=0 not-last, len=34] + STREAMINFO +
    //        [hdr2: type=4 LAST, len=40] + VORBIS_COMMENT
    const out = new Uint8Array(4 + 34 + 4 + vorbisCommentLen);
    out[0] = 0x00; // not last, type=STREAMINFO
    out[1] = 0; out[2] = 0; out[3] = 34;
    out.set(streaminfo, 4);
    out[38] = 0x80 | 0x04; // last, type=VORBIS_COMMENT
    out[39] = 0; out[40] = 0; out[41] = vorbisCommentLen;
    out.set(vorbisComment, 42);
    return out;
  }

  function makeFlac(codecPrivate: Uint8Array): AudioTrackInfo {
    return {
      trackNumber: 2,
      codec: "flac",
      codecPrivate,
      sampleRate: 48000,
      channels: 2,
      defaultDurationNs: 96_000_000,
      language: "jpn",
      name: "Japanese 2.0",
    };
  }

  it("emits only STREAMINFO inside dfLa, dropping VORBIS_COMMENT and friends", () => {
    const cp = makeMultiBlockCodecPrivate();
    const { data } = generateInitSegment(VIDEO_AVC, makeFlac(cp));
    const dflaStart = findBox(data, "dfLa");
    // dfLa: [size:4][type:4][version+flags:4][metadata blocks...]
    // Read box size (big-endian uint32 at dflaStart)
    const dflaBoxSize =
      (data[dflaStart] << 24) |
      (data[dflaStart + 1] << 16) |
      (data[dflaStart + 2] << 8) |
      data[dflaStart + 3];
    // Payload = boxSize - 8 (box hdr) - 4 (version+flags) = STREAMINFO header (4) + content (34)
    expect(dflaBoxSize).toBe(8 + 4 + 4 + 34);

    // First payload byte = metadata-block header: top bit set (last block),
    // bottom 7 bits = block_type = 0 (STREAMINFO).
    const firstPayloadByte = data[dflaStart + 12];
    expect(firstPayloadByte & 0x80).toBe(0x80);
    expect(firstPayloadByte & 0x7f).toBe(0);
  });
});

describe("buildFlac — AudioSampleEntry bit depth", () => {
  // A 34-byte STREAMINFO with bits_per_sample baked into the packed field.
  // bits_per_sample is stored as (value - 1) in 5 bits straddling byte 12
  // bit0 and byte 13's top 4 bits.
  function makeStreamInfo(bitsPerSample: number): Uint8Array {
    const si = new Uint8Array(34);
    const v = bitsPerSample - 1;
    si[12] = (si[12] & 0xfe) | ((v >> 4) & 0x01);
    si[13] = (si[13] & 0x0f) | ((v & 0x0f) << 4);
    return si;
  }
  function makeFlac(codecPrivate: Uint8Array): AudioTrackInfo {
    return {
      trackNumber: 2,
      codec: "flac",
      codecPrivate,
      sampleRate: 48000,
      channels: 2,
      defaultDurationNs: 96_000_000,
      language: "jpn",
      name: "Japanese 2.0",
    };
  }
  // samplesize lives at AudioSampleEntry prefix offset 18; the prefix begins
  // 8 bytes (box header) into the fLaC box.
  function readSampleSize(data: Uint8Array): number {
    const flacStart = findBox(data, "fLaC");
    return (data[flacStart + 26] << 8) | data[flacStart + 27];
  }

  it("advertises 24-bit sample size for 24-bit FLAC STREAMINFO", () => {
    const { data } = generateInitSegment(VIDEO_AVC, makeFlac(makeStreamInfo(24)));
    expect(readSampleSize(data)).toBe(24);
  });

  it("advertises 16-bit sample size for 16-bit FLAC STREAMINFO", () => {
    const { data } = generateInitSegment(VIDEO_AVC, makeFlac(makeStreamInfo(16)));
    expect(readSampleSize(data)).toBe(16);
  });
});

describe("parseSimpleBlock — lacing", () => {
  // We poke at parseSimpleBlock indirectly through ebml.ts. To keep this
  // module-local we use a vitest dynamic import.
  it("unpacks EBML lacing into per-frame buffers", async () => {
    const { parseSimpleBlock } = await import("../ebml");
    // Hand-craft a SimpleBlock body that mimics YURASUKA's first audio block:
    //   track number VINT (0x82 = track 2)
    //   timecode (2 bytes, signed BE) = 0
    //   flags = 0x86 → keyframe=1, lacing=3 (EBML)
    //   lacing data:
    //     0x02 → count - 1 = 2, so 3 frames total
    //     0x82 → unsigned EBML VINT, length 1, value=2 → first frame size 2
    //     0x82 → signed EBML VINT, length 1, value=2, bias=63 → delta=-61
    //              → 2nd frame size = 2 + (-61) — illegal in real lacing, but
    //              for the parser test we want to see it slot bytes correctly
    //     Frames: any 5 bytes (size=2 + size=-59 + remainder=… won't matter)
    //
    // Simpler: just use sizes [3, 4] explicitly so the math is clean.
    //   first  VINT(3, unsigned, 1 byte) = 0x83
    //   second VINT(unsigned 64, signed delta = 64-63 = +1, 1 byte) = 0xc0
    //   → frame sizes: 3, 4, rest
    const body = new Uint8Array([
      0x82,                         // track = 2 (VINT)
      0x00, 0x00,                   // timecode = 0
      0x86,                         // keyframe + EBML lacing
      0x02,                         // 3 frames
      0x83,                         // first size = 3 (unsigned VINT)
      0xc0,                         // delta = +1 → second size = 4
      // frames concatenated:
      0xaa, 0xbb, 0xcc,             // frame 0 (3 bytes)
      0x11, 0x22, 0x33, 0x44,       // frame 1 (4 bytes)
      0xff, 0xf8, 0x99, 0x99,       // frame 2 (remainder = 4 bytes)
    ]);
    const result = parseSimpleBlock(body, 0, body.length);
    expect(result.trackNumber).toBe(2);
    expect(result.frames.length).toBe(3);
    expect(Array.from(result.frames[0])).toEqual([0xaa, 0xbb, 0xcc]);
    expect(Array.from(result.frames[1])).toEqual([0x11, 0x22, 0x33, 0x44]);
    expect(Array.from(result.frames[2])).toEqual([0xff, 0xf8, 0x99, 0x99]);
  });

  it("returns a single-element frames array when lacing is disabled", async () => {
    const { parseSimpleBlock } = await import("../ebml");
    const body = new Uint8Array([
      0x82,                         // track = 2
      0x00, 0x00,                   // timecode = 0
      0x80,                         // keyframe, no lacing
      0xff, 0xf8, 0x12, 0x34,       // frame data (one whole frame)
    ]);
    const result = parseSimpleBlock(body, 0, body.length);
    expect(result.frames.length).toBe(1);
    expect(Array.from(result.frames[0])).toEqual([0xff, 0xf8, 0x12, 0x34]);
  });
});

describe("generateVideoInitSegment — HEVC sample entry", () => {
  // Minimal HEVCDecoderConfigurationRecord: Main10 profile, Level 5.0.
  // Just enough bytes for buildHevcCodecString to parse without trapping.
  const HVCC_MAIN10 = new Uint8Array(23);
  HVCC_MAIN10[0] = 0x01; // configurationVersion
  HVCC_MAIN10[1] = 0x02; // profile_space=0, tier=0, profile_idc=2 (Main10)
  HVCC_MAIN10[2] = 0x20; // compat flags byte 0
  // bytes 3-5: rest of compat flags = 0
  HVCC_MAIN10[6] = 0x90; // first constraint indicator byte (progressive)
  // bytes 7-11: rest of constraints = 0
  HVCC_MAIN10[12] = 150; // level_idc = 5.0
  HVCC_MAIN10[22] = 0x03; // lengthSizeMinusOne=3 + flags

  const VIDEO_HEVC: VideoTrackInfo = {
    trackNumber: 1,
    codec: "hevc",
    codecPrivate: HVCC_MAIN10,
    width: 1920,
    height: 1080,
    defaultDurationNs: 41_708_333,
  };

  it("emits an `hev1` sample entry (not `hvc1`) to match the codec string", () => {
    const { data, codecString } = generateVideoInitSegment(VIDEO_HEVC);
    expect(codecString.startsWith("hev1.")).toBe(true);
    expect(() => findBox(data, "hev1")).not.toThrow();
    // `hvc1` would be a strict sample entry that forbids inline VPS/SPS/PPS
    // — exactly what x265 anime encodes ship. Make sure we never emit it.
    expect(() => findBox(data, "hvc1")).toThrow();
  });
});
