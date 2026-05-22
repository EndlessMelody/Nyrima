import { describe, expect, it } from "vitest";
import { convertBytesToFloat32 } from "./ac3-wasm-decoder";

describe("ac3-wasm-decoder helper tests", () => {
  describe("convertBytesToFloat32", () => {
    it("correctly converts planar float data without throwing RangeError", () => {
      // 3 frames of Float32 (4 bytes per sample), 2 channels.
      // In planar mode, each channel has its own buffer of size: frames * bytesPerSample = 3 * 4 = 12 bytes.
      const sampleDataCh0 = new Float32Array([1.0, 2.0, 3.0]);
      const sampleDataCh1 = new Float32Array([4.0, 5.0, 6.0]);

      const bytesCh0 = new Uint8Array(sampleDataCh0.buffer);
      const bytesCh1 = new Uint8Array(sampleDataCh1.buffer);

      const format = {
        bytesPerSample: 4 as const,
        planar: true,
        read: (view: DataView, byteOffset: number) => view.getFloat32(byteOffset, true),
      };

      // In copyPlanar, strideFrames is 1, channel is 0 (as per the bugfix)
      const resCh0 = convertBytesToFloat32(bytesCh0, format, 3, 1, 0);
      const resCh1 = convertBytesToFloat32(bytesCh1, format, 3, 1, 0);

      expect(Array.from(resCh0)).toEqual([1.0, 2.0, 3.0]);
      expect(Array.from(resCh1)).toEqual([4.0, 5.0, 6.0]);
    });

    it("correctly converts interleaved float data", () => {
      // 3 frames, 2 channels, interleaved: [L0, R0, L1, R1, L2, R2]
      const sampleDataInterleaved = new Float32Array([1.0, 4.0, 2.0, 5.0, 3.0, 6.0]);
      const bytes = new Uint8Array(sampleDataInterleaved.buffer);

      const format = {
        bytesPerSample: 4 as const,
        planar: false,
        read: (view: DataView, byteOffset: number) => view.getFloat32(byteOffset, true),
      };

      // In copyInterleaved, strideFrames is channels (2)
      const resCh0 = convertBytesToFloat32(bytes, format, 3, 2, 0);
      const resCh1 = convertBytesToFloat32(bytes, format, 3, 2, 1);

      expect(Array.from(resCh0)).toEqual([1.0, 2.0, 3.0]);
      expect(Array.from(resCh1)).toEqual([4.0, 5.0, 6.0]);
    });
  });
});
