/**
 * Parser for the HEVCDecoderConfigurationRecord ("hvcC") payload — i.e. the
 * MKV `CodecPrivate` for `V_MPEGH/ISO/HEVC` tracks (ISO/IEC 14496-15).
 *
 * Why this exists: HEVC's "Format Range Extensions" (REXT) profile — used
 * for 4:2:2/4:4:4 chroma subsampling and/or >10-bit depth — has no consumer
 * GPU or OS codec pack decoder (Windows HEVC Video Extensions and every
 * mainstream GPU only cover Main/Main10 4:2:0). `MediaSource.isTypeSupported`
 * still reports these streams as supported and MSE happily accepts the
 * samples, but the OS decoder produces nothing — the result is a black
 * picture with working audio. Parsing the chroma/bit-depth fields here lets
 * the player detect this case up front and show a truthful message instead.
 */

export type HevcChromaFormat = "4:0:0" | "4:2:0" | "4:2:2" | "4:4:4" | "unknown";

export interface HvccInfo {
  generalProfileSpace: number;
  generalTierFlag: number;
  generalProfileIdc: number;
  generalLevelIdc: number;
  chromaFormatIdc: number;
  chromaFormat: HevcChromaFormat;
  bitDepthLuma: number;
  bitDepthChroma: number;
  /** NAL length-field size in bytes (1, 2, or 4) used by this stream's samples. */
  lengthSize: number;
  /** True for `general_profile_idc === 4`, the "Format Range Extensions" profile. */
  isRextProfile: boolean;
  /**
   * True when no consumer GPU/OS decoder can be expected to handle this
   * stream — REXT profile, 4:2:2/4:4:4 chroma, and/or >10-bit depth.
   * Main/Main10 4:2:0 (8/10-bit) returns false.
   */
  requiresSoftwareDecode: boolean;
}

const CHROMA_FORMATS: HevcChromaFormat[] = ["4:0:0", "4:2:0", "4:2:2", "4:4:4"];

/**
 * Parse an HEVCDecoderConfigurationRecord. Returns `null` if `cp` is too
 * short to contain the fixed-size header fields up to (and including) byte
 * 18 (`bit_depth_chroma_minus8`).
 */
export function parseHvccInfo(cp: Uint8Array): HvccInfo | null {
  if (cp.length < 19) return null;

  const generalProfileSpace = (cp[1] >> 6) & 0x03;
  const generalTierFlag = (cp[1] >> 5) & 0x01;
  const generalProfileIdc = cp[1] & 0x1f;
  const generalLevelIdc = cp[12];
  const chromaFormatIdc = cp[16] & 0x03;
  const bitDepthLuma = (cp[17] & 0x07) + 8;
  const bitDepthChroma = (cp[18] & 0x07) + 8;
  const lengthSize = cp.length > 21 ? (cp[21] & 0x03) + 1 : 4;

  const isRextProfile = generalProfileIdc === 4;
  const requiresSoftwareDecode =
    isRextProfile ||
    chromaFormatIdc >= 2 ||
    bitDepthLuma > 10 ||
    bitDepthChroma > 10;

  return {
    generalProfileSpace,
    generalTierFlag,
    generalProfileIdc,
    generalLevelIdc,
    chromaFormatIdc,
    chromaFormat: CHROMA_FORMATS[chromaFormatIdc] ?? "unknown",
    bitDepthLuma,
    bitDepthChroma,
    lengthSize,
    isRextProfile,
    requiresSoftwareDecode,
  };
}

/** Human-readable summary for error/diagnostic UI, e.g. "REXT 4:2:2 12-bit". */
export function describeHevcProfile(info: HvccInfo): string {
  const bits =
    info.bitDepthLuma === info.bitDepthChroma
      ? `${info.bitDepthLuma}-bit`
      : `${info.bitDepthLuma}/${info.bitDepthChroma}-bit`;
  const profile = info.isRextProfile
    ? "REXT"
    : `Profile ${info.generalProfileIdc}`;
  return `${profile} ${info.chromaFormat} ${bits}`;
}
