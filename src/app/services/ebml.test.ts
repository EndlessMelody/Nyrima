import { describe, expect, it } from "vitest";
import { readVint, readUint } from "./ebml";

describe("readVint", () => {
  it("decodes 1-byte VINTs", () => {
    expect(readVint(new Uint8Array([0x82]), 0)).toEqual({ value: 2, length: 1 });
  });

  it("decodes 4-byte VINTs (EBML header ID range)", () => {
    // 0x1F is a 4-byte VINT marker; value bits = 0x1F & 0x0F (mask 0x10),
    // followed by 3 more bytes.
    const buf = new Uint8Array([0x1f, 0x43, 0xb6, 0x75]);
    const r = readVint(buf, 0);
    expect(r.length).toBe(4);
    // Value bits: 0x0F << 24 | 0x43B675 = 0x0F43B675
    expect(r.value).toBe(0x0f43b675);
  });

  it("decodes 8-byte VINTs above 2 GiB without int32 wrap", () => {
    // 8-byte VINT for 2,868,567,701 (matches the Majo no Tabitabi BDRip
    // segment size). Marker bit = 0x01 in the first byte; the remaining
    // 7 bytes carry the value in big-endian.
    const v = 2_868_567_701;
    const bytes = new Uint8Array(8);
    bytes[0] = 0x01;
    let rem = v;
    for (let i = 7; i >= 1; i--) {
      bytes[i] = rem & 0xff;
      rem = Math.floor(rem / 0x100);
    }
    expect(readVint(bytes, 0)).toEqual({ value: v, length: 8 });
  });
});

describe("readUint", () => {
  it("decodes multi-byte uints accurately past 31 bits", () => {
    // 5-byte uint = 0x01_00_00_00_00 (2^32) — should not wrap negative.
    const bytes = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00]);
    expect(readUint(bytes, 0, 5)).toBe(0x100000000);
  });

  it("decodes a typical timecode (3 bytes)", () => {
    // 4_500_000 ms = ~1h 15m, a normal anime episode runtime in MKV
    // TimecodeScale=1ms units.
    const bytes = new Uint8Array([0x44, 0xaa, 0x20]);
    expect(readUint(bytes, 0, 3)).toBe(0x44aa20);
  });
});
