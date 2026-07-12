import { describe, expect, it } from "vitest";
import { describeHevcProfile, parseHvccInfo } from "./hvcc";

/**
 * Build a minimal (22-byte) HEVCDecoderConfigurationRecord with just the
 * fields `parseHvccInfo` reads. Byte layout per ISO/IEC 14496-15:
 *   [0]  configurationVersion
 *   [1]  profile_space(2) | tier_flag(1) | profile_idc(5)
 *   [12] level_idc
 *   [16] reserved(6) | chroma_format_idc(2)
 *   [17] reserved(5) | bit_depth_luma_minus8(3)
 *   [18] reserved(5) | bit_depth_chroma_minus8(3)
 *   [21] constantFrameRate(2) | numTemporalLayers(3) | temporalIdNested(1) | lengthSizeMinusOne(2)
 */
function buildHvcc(opts: {
  profileSpace?: number;
  tierFlag?: number;
  profileIdc: number;
  levelIdc?: number;
  chromaFormatIdc: number;
  bitDepthLumaMinus8: number;
  bitDepthChromaMinus8: number;
  lengthSizeMinusOne?: number;
}): Uint8Array {
  const cp = new Uint8Array(22);
  cp[0] = 0x01;
  cp[1] =
    ((opts.profileSpace ?? 0) << 6) |
    ((opts.tierFlag ?? 0) << 5) |
    (opts.profileIdc & 0x1f);
  cp[12] = opts.levelIdc ?? 120;
  cp[16] = opts.chromaFormatIdc & 0x03;
  cp[17] = 0xf8 | (opts.bitDepthLumaMinus8 & 0x07);
  cp[18] = 0xf8 | (opts.bitDepthChromaMinus8 & 0x07);
  cp[21] = 0xfc | (opts.lengthSizeMinusOne ?? 3);
  return cp;
}

describe("parseHvccInfo", () => {
  it("returns null when the buffer is too short", () => {
    expect(parseHvccInfo(new Uint8Array(18))).toBeNull();
  });

  it("defaults lengthSize to 4 when byte 21 is absent", () => {
    const cp = buildHvcc({
      profileIdc: 1,
      chromaFormatIdc: 1,
      bitDepthLumaMinus8: 0,
      bitDepthChromaMinus8: 0,
    }).slice(0, 19);
    const info = parseHvccInfo(cp)!;
    expect(info.lengthSize).toBe(4);
  });

  it("Main profile, 4:2:0, 8-bit does not require software decode", () => {
    const cp = buildHvcc({
      profileIdc: 1,
      chromaFormatIdc: 1,
      bitDepthLumaMinus8: 0,
      bitDepthChromaMinus8: 0,
    });
    const info = parseHvccInfo(cp)!;
    expect(info.generalProfileIdc).toBe(1);
    expect(info.chromaFormat).toBe("4:2:0");
    expect(info.bitDepthLuma).toBe(8);
    expect(info.bitDepthChroma).toBe(8);
    expect(info.isRextProfile).toBe(false);
    expect(info.requiresSoftwareDecode).toBe(false);
    expect(info.lengthSize).toBe(4);
  });

  it("Main10 profile, 4:2:0, 10-bit does not require software decode", () => {
    const cp = buildHvcc({
      profileIdc: 2,
      chromaFormatIdc: 1,
      bitDepthLumaMinus8: 2,
      bitDepthChromaMinus8: 2,
    });
    const info = parseHvccInfo(cp)!;
    expect(info.chromaFormat).toBe("4:2:0");
    expect(info.bitDepthLuma).toBe(10);
    expect(info.bitDepthChroma).toBe(10);
    expect(info.isRextProfile).toBe(false);
    expect(info.requiresSoftwareDecode).toBe(false);
  });

  it("REXT profile, 4:2:2, 10-bit requires software decode", () => {
    const cp = buildHvcc({
      profileIdc: 4,
      profileSpace: 1,
      chromaFormatIdc: 2,
      bitDepthLumaMinus8: 2,
      bitDepthChromaMinus8: 2,
    });
    const info = parseHvccInfo(cp)!;
    expect(info.chromaFormat).toBe("4:2:2");
    expect(info.bitDepthLuma).toBe(10);
    expect(info.isRextProfile).toBe(true);
    expect(info.requiresSoftwareDecode).toBe(true);
    expect(describeHevcProfile(info)).toBe("REXT 4:2:2 10-bit");
  });

  it("REXT profile, 4:2:2, 12-bit requires software decode", () => {
    const cp = buildHvcc({
      profileIdc: 4,
      profileSpace: 1,
      chromaFormatIdc: 2,
      bitDepthLumaMinus8: 4,
      bitDepthChromaMinus8: 4,
      lengthSizeMinusOne: 3,
    });
    const info = parseHvccInfo(cp)!;
    expect(info.chromaFormat).toBe("4:2:2");
    expect(info.bitDepthLuma).toBe(12);
    expect(info.bitDepthChroma).toBe(12);
    expect(info.requiresSoftwareDecode).toBe(true);
    expect(info.lengthSize).toBe(4);
    expect(describeHevcProfile(info)).toBe("REXT 4:2:2 12-bit");
  });

  it("REXT profile, 4:4:4, 12-bit requires software decode", () => {
    const cp = buildHvcc({
      profileIdc: 4,
      profileSpace: 1,
      chromaFormatIdc: 3,
      bitDepthLumaMinus8: 4,
      bitDepthChromaMinus8: 4,
    });
    const info = parseHvccInfo(cp)!;
    expect(info.chromaFormat).toBe("4:4:4");
    expect(info.requiresSoftwareDecode).toBe(true);
  });

  it("non-REXT profile reporting >10-bit still requires software decode", () => {
    // Defensive case: some encoders signal high bit depth without
    // profile_idc===4. Bit depth alone should still gate routing.
    const cp = buildHvcc({
      profileIdc: 2,
      chromaFormatIdc: 1,
      bitDepthLumaMinus8: 4,
      bitDepthChromaMinus8: 4,
    });
    const info = parseHvccInfo(cp)!;
    expect(info.isRextProfile).toBe(false);
    expect(info.requiresSoftwareDecode).toBe(true);
    expect(describeHevcProfile(info)).toBe("Profile 2 4:2:0 12-bit");
  });

  it("mismatched luma/chroma bit depth formats both in the description", () => {
    const cp = buildHvcc({
      profileIdc: 4,
      profileSpace: 1,
      chromaFormatIdc: 2,
      bitDepthLumaMinus8: 4,
      bitDepthChromaMinus8: 2,
    });
    const info = parseHvccInfo(cp)!;
    expect(info.bitDepthLuma).toBe(12);
    expect(info.bitDepthChroma).toBe(10);
    expect(describeHevcProfile(info)).toBe("REXT 4:2:2 12/10-bit");
  });
});
