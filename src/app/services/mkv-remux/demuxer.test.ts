import { describe, expect, it } from "vitest";
import {
  extractClusterSamplesFromRange,
  findFirstClusterOffset,
  parseAc3SpecificBoxFields,
} from "./demuxer";
import type { MkvMediaInfo } from "./types";

const INFO: MkvMediaInfo = {
  timecodeScaleNs: 1_000_000,
  durationMs: 10_000,
  video: {
    trackNumber: 1,
    codec: "hevc",
    codecPrivate: new Uint8Array(0),
    width: 1920,
    height: 1080,
    defaultDurationNs: 41_708_333,
  },
  audio: {
    trackNumber: 2,
    codec: "opus",
    codecPrivate: new Uint8Array(0),
    sampleRate: 48000,
    channels: 2,
    defaultDurationNs: 20_000_000,
    language: "jpn",
    name: "Japanese",
  },
  audioTracks: [],
  firstClusterOffset: 0,
};

function element(id: number, payload: Uint8Array): Uint8Array {
  return new Uint8Array([id, 0x80 | payload.length, ...payload]);
}

function simpleAudioBlock(frame: number[]): Uint8Array {
  return element(
    0xa3,
    new Uint8Array([
      0x82, // TrackNumber 2
      0x00, 0x00, // block timecode
      0x80, // keyframe, no lacing
      ...frame,
    ]),
  );
}

function fixedLacedAudioBlock(frames: number[][]): Uint8Array {
  return element(
    0xa3,
    new Uint8Array([
      0x82, // TrackNumber 2
      0x00, 0x00, // block timecode
      0x84, // keyframe, fixed lacing
      frames.length - 1,
      ...frames.flat(),
    ]),
  );
}

describe("extractClusterSamplesFromRange", () => {
  it("emits complete child blocks from a partial Cluster range", () => {
    const timecode = element(0xe7, new Uint8Array([0x05]));
    const completeBlock = simpleAudioBlock([0xfc, 0x11, 0x22]);
    const incompleteBlock = simpleAudioBlock([0x33, 0x44]).subarray(0, 7);
    const buf = new Uint8Array([
      ...timecode,
      ...completeBlock,
      ...incompleteBlock,
    ]);

    const result = extractClusterSamplesFromRange(buf, 0, buf.length, 0, INFO);

    expect(result.clusterTimeMs).toBe(5);
    expect(result.consumedOffset).toBe(timecode.length + completeBlock.length);
    expect(result.samples).toHaveLength(1);
    expect(result.samples[0]).toMatchObject({
      trackNumber: 2,
      isVideo: false,
      pts: 5,
      duration: 20,
      isKeyframe: true,
    });
    expect(Array.from(result.samples[0].data)).toEqual([0xfc, 0x11, 0x22]);
  });

  it("derives laced Opus packet timing when TrackEntry omits DefaultDuration", () => {
    const info: MkvMediaInfo = {
      ...INFO,
      audio: {
        ...INFO.audio!,
        codec: "opus",
        defaultDurationNs: 0,
      },
    };
    const timecode = element(0xe7, new Uint8Array([0x05]));
    const block = fixedLacedAudioBlock([
      [0xfc, 0x11, 0x22],
      [0xfc, 0x33, 0x44],
    ]);
    const buf = new Uint8Array([...timecode, ...block]);

    const result = extractClusterSamplesFromRange(buf, 0, buf.length, 0, info);

    expect(result.samples).toHaveLength(2);
    expect(result.samples.map((s) => s.pts)).toEqual([5, 25]);
    expect(result.samples.map((s) => s.duration)).toEqual([20, 20]);
  });

  it("derives AC-3 frame timing when TrackEntry omits DefaultDuration", () => {
    const info: MkvMediaInfo = {
      ...INFO,
      audio: {
        ...INFO.audio!,
        codec: "ac3",
        defaultDurationNs: 0,
      },
    };
    const ac3Frame = [
      0x0b, 0x77, 0x35, 0x1d,
      0x14, 0x40, 0x43, 0xe1,
    ];
    const timecode = element(0xe7, new Uint8Array([0x05]));
    const block = simpleAudioBlock(ac3Frame);
    const buf = new Uint8Array([...timecode, ...block]);

    const result = extractClusterSamplesFromRange(buf, 0, buf.length, 0, info);

    expect(result.samples).toHaveLength(1);
    expect(result.samples[0].duration).toBe(32);
  });

  it("stops at the next Cluster boundary inside an unknown-size Cluster", () => {
    const timecode = element(0xe7, new Uint8Array([0x05]));
    const nextCluster = new Uint8Array([
      0x1f, 0x43, 0xb6, 0x75, // Cluster
      0x80, // zero-length payload
    ]);
    const trailingBlock = simpleAudioBlock([0x11, 0x22]);
    const buf = new Uint8Array([
      ...timecode,
      ...nextCluster,
      ...trailingBlock,
    ]);

    const result = extractClusterSamplesFromRange(buf, 0, buf.length, 0, INFO);

    expect(result.reachedClusterBoundary).toBe(true);
    expect(result.consumedOffset).toBe(timecode.length);
    expect(result.samples).toHaveLength(0);
  });
});

describe("parseAc3SpecificBoxFields", () => {
  it("reads dac3 fields from an AC-3 sync frame header", () => {
    const frame = new Uint8Array([
      0x0b, 0x77, 0x35, 0x1d,
      0x14, 0x40, 0x43, 0xe1,
    ]);

    expect(parseAc3SpecificBoxFields(frame)).toEqual({
      fscod: 0,
      bsid: 8,
      bsmod: 0,
      acmod: 2,
      lfeon: 0,
      bitRateCode: 10,
    });
  });

  it("rejects non-AC-3 payloads", () => {
    expect(parseAc3SpecificBoxFields(new Uint8Array([0x00, 0x00]))).toBeNull();
  });
});

describe("findFirstClusterOffset", () => {
  it("finds a Cluster ID when structured top-level walking missed it", () => {
    const buf = new Uint8Array([
      0x00, 0x00,
      0x18, 0x53, 0x80, 0x67, // Segment, should not be returned
      0x84, 0x11, 0x22, 0x33, 0x44,
      0x1f, 0x43, 0xb6, 0x75, // Cluster
      0x80, // zero-length payload
    ]);

    expect(findFirstClusterOffset(buf, 0, buf.length)).toBe(11);
  });
});
